import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../lib/plugin-install-ledger'
import {
  getPluginInstallSpecIdentityKey,
  isSamePluginInstallSpecIdentity,
  normalizePluginInstallSpecIdentity,
} from '../../lib/plugin-install-spec'
import { resolvePackSpec } from '../../lib/pack-resolver'
import { parseRegistryPackSpec } from '../../lib/registry-spec'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  uninstallPluginProviders,
} from '../../lib/plugin-providers'
import type { PluginInstallRecord, RegistryRef } from '../../lib/types'

function resolveUninstallSpecIdentity(
  spec: string,
  cwd: string,
  registries: RegistryRef[],
  records: PluginInstallRecord[]
) {
  try {
    return normalizePluginInstallSpecIdentity(spec, cwd, registries)
  } catch (error) {
    const parsed = parseRegistryPackSpec(spec)
    const matches = records.filter(
      (record) => record.specIdentity.kind === 'registry' && record.specIdentity.packName === parsed.pack
    )
    const identities = [
      ...new Map(
        matches.map((record) => [getPluginInstallSpecIdentityKey(record.specIdentity), record.specIdentity])
      ).values(),
    ]
    if (identities.length === 1) {
      return identities[0]
    }
    throw error
  }
}

function printUninstallPlan(
  provider: string,
  packName: string,
  records: Array<{ scope: string; pluginName: string; targetPaths: string[] }>
) {
  console.log('Uninstall plan:')
  console.log(`  provider: ${provider}`)
  console.log(`  pack: ${packName}`)
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
    description: 'Remove an AgentRig-managed provider plugin for a resolved pack spec.',
  },
  args: {
    provider: {
      type: 'positional',
      description: 'Provider to uninstall for: claude, codex, or cursor',
      required: true,
    },
    spec: {
      type: 'positional',
      description: 'Pack name, registryAlias/pack, or a meta.json URL/path',
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
    const providerRecords = allRecords.filter(
      (record) => record.provider === provider && (!scope || record.scope === scope)
    )
    const cfg = await loadConfig(cwd)
    const specIdentity = resolveUninstallSpecIdentity(spec, cwd, cfg.registries, providerRecords)
    let packName = specIdentity.kind === 'registry' ? specIdentity.packName : spec
    try {
      const resolved = await resolvePackSpec(spec, cwd, cfg.registries)
      packName = resolved.meta.name
    } catch {
      const matchedRecord = providerRecords.find((record) =>
        isSamePluginInstallSpecIdentity(record.specIdentity, specIdentity)
      )
      if (matchedRecord) {
        packName = matchedRecord.packName
      }
    }
    const matchingRecords = allRecords.filter(
      (record) =>
        record.provider === provider &&
        isSamePluginInstallSpecIdentity(record.specIdentity, specIdentity) &&
        (!scope || record.scope === scope)
    )

    if (matchingRecords.length === 0) {
      throw new Error(
        `No AgentRig-managed ${provider} plugin installs were found for pack "${packName}".`
      )
    }

    printUninstallPlan(provider, packName, matchingRecords)

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
