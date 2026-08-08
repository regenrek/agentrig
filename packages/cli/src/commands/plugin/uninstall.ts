import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { uninstallSelectionInstallRecords } from '../../lib/artifact-selection-install'
import { loadConfig } from '../../lib/config'
import {
  loadPluginInstallLedgers,
  listPluginInstallRecords,
  listSelectionInstallRecords,
} from '../../lib/plugin-install-ledger'
import {
  isSamePluginInstallSpecIdentity,
  resolvePluginInstallSpecIdentity,
} from '../../lib/plugin-install-spec'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  uninstallPluginProviders,
} from '../../lib/plugin-providers'

function printUninstallPlan(
  provider: string,
  pluginId: string,
  records: Array<{ scope: string; pluginName: string; targetPaths: string[] }>
) {
  console.log('Uninstall plan:')
  console.log(`  provider: ${provider}`)
  console.log(`  plugin: ${pluginId}`)
  console.log(`  scopes: ${[...new Set(records.map((record) => record.scope))].join(', ')}`)

  for (const record of records) {
    console.log(`${record.pluginName} [${record.scope}]`)
    for (const targetPath of record.targetPaths) {
      console.log(`  -> ${targetPath}`)
    }
  }
}

const command = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove an AgentRig-managed provider plugin for a resolved plugin spec.',
  },
  args: {
    provider: {
      type: 'positional',
      description: 'Provider to uninstall for: claude, codex, or cursor',
      required: true,
    },
    spec: {
      type: 'positional',
      description: 'Canonical registry ref, or an AgentRig-managed external plugin id/name',
      required: true,
    },
    cwd: {
      type: 'string',
      description: 'Working directory (defaults to current directory)',
    },
    scope: {
      type: 'string',
      description: 'Optional install scope: personal or workspace',
    },
    dryRun: {
      type: 'boolean',
      description: 'Show what would be removed without invoking provider CLIs or deleting files.',
      default: false,
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const provider = parsePluginProviderSelector(String(args.provider))
    if (provider === 'all') {
      throw new Error('`agentrig plugin uninstall` requires a single provider.')
    }

    const spec = String(args.spec)
    const scope = args.scope
      ? parsePluginInstallScopeSelector(String(args.scope))
      : undefined
    if (scope === 'auto') {
      throw new Error('Use `--scope personal` or `--scope workspace` when narrowing plugin uninstalls.')
    }

    const ledgers = await loadPluginInstallLedgers(cwd)
    const allRecords = listPluginInstallRecords(ledgers, scope)
    const allSelectionRecords = listSelectionInstallRecords(ledgers, scope)
    const providerRecords = allRecords.filter(
      (record) =>
        record.provider === provider &&
        (!scope || record.scope === scope)
    )
    const externalRecords = providerRecords.filter(
      (record) =>
        record.specIdentity.kind === 'external-repo' &&
        (record.pluginId === spec || record.pluginName === spec)
    )
    const externalSelectionRecords = allSelectionRecords.filter(
      (record) =>
        record.provider === provider &&
        (!scope || record.scope === scope) &&
        record.specIdentity.kind === 'external-repo' &&
        record.pluginId === spec
    )
    if (externalSelectionRecords.length > 0) {
      printUninstallPlan(
        provider,
        spec,
        externalSelectionRecords.map((record) => ({
          scope: record.scope,
          pluginName: record.selectedSelectors.join(', '),
          targetPaths: record.targetPaths,
        }))
      )
      const result = await uninstallSelectionInstallRecords({
        cwd,
        records: externalSelectionRecords,
        dryRun: args.dryRun,
      })
      console.log(
        `${provider} selection: removed ${result.removed.length}, kept ${result.kept.length}, missing ${result.missing.length}`
      )
      if (externalRecords.length === 0) return
    }
    const cfg = await loadConfig(cwd)
    const specIdentity = externalRecords.length > 0
      ? undefined
      : await resolvePluginInstallSpecIdentity(spec, cwd, cfg.registries)
    if (specIdentity?.kind === 'registry-artifact') {
      throw new Error('`agentrig plugin uninstall` only accepts plugin install refs.')
    }
    const pluginId = specIdentity?.pluginId ?? spec
    const matchingRecords = specIdentity
      ? providerRecords.filter((record) => isSamePluginInstallSpecIdentity(record.specIdentity, specIdentity))
      : externalRecords

    if (matchingRecords.length === 0) {
      throw new Error(
        `No AgentRig-managed ${provider} plugin installs were found for plugin "${pluginId}".`
      )
    }

    printUninstallPlan(provider, pluginId, matchingRecords)

    const results = await uninstallPluginProviders(matchingRecords, {
      cwd,
      dryRun: args.dryRun,
    })

    for (const result of results) {
      console.log(
        `${result.provider}: removed ${result.removed.length}, kept ${result.kept.length}, missing ${result.missing.length}`
      )
      for (const location of result.locations) {
        console.log(`  -> ${location}`)
      }
    }
  },
})

export default command
