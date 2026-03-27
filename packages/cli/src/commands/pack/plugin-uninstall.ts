import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  uninstallPluginProviders,
  type PluginInstallScopeSelector,
  type PluginProviderSelector,
} from '../../lib/plugin-providers'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../lib/plugin-install-ledger'
import { selectOption } from '../../lib/interactive'
import type { PluginInstallRecord } from '../../lib/types'

function hasFlag(rawArgs: string[] | undefined, name: string) {
  return Boolean(rawArgs?.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`)))
}

function isInteractiveTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

async function resolveProviderSelection(
  rawArgs: string[] | undefined,
  args: Record<string, unknown>,
  records: PluginInstallRecord[]
): Promise<PluginProviderSelector> {
  const interactive = isInteractiveTty()
  const explicitAgent = hasFlag(rawArgs, 'agent')
  const wantsAll = Boolean(args.all)

  if (explicitAgent) {
    const provider = parsePluginProviderSelector(String(args.agent))
    if (provider === 'all' && !wantsAll) {
      throw new Error('Uninstalling across all providers requires `--all`.')
    }
    return provider
  }

  if (wantsAll) return 'all'

  if (!interactive) {
    throw new Error('Non-interactive uninstalls require `--agent <provider>` or `--all`.')
  }

  const providers = [...new Set(records.map((record) => record.provider))]
  return selectOption(
    [...providers, 'all'] as const,
    (provider) => (provider === 'all' ? 'All providers' : provider),
    'Select a provider'
  )
}

async function resolvePackSelection(
  rawArgs: string[] | undefined,
  args: Record<string, unknown>,
  records: PluginInstallRecord[]
) {
  const interactive = isInteractiveTty()
  const explicitPack = hasFlag(rawArgs, 'pack')
  const wantsAll = Boolean(args.all)

  if (explicitPack) {
    return String(args.pack)
  }

  if (wantsAll) return undefined

  if (!interactive) {
    throw new Error('Non-interactive uninstalls require `--pack <name>` or `--all`.')
  }

  const packs = [...new Set(records.map((record) => record.packName))].sort()
  const selected = await selectOption(
    ['__all__', ...packs],
    (item) => (item === '__all__' ? 'All installed packs' : item),
    'Select a pack'
  )
  return selected === '__all__' ? undefined : selected
}

async function resolveScopeSelection(
  rawArgs: string[] | undefined,
  args: Record<string, unknown>,
  records: PluginInstallRecord[]
): Promise<PluginInstallScopeSelector> {
  const interactive = isInteractiveTty()
  const explicitScope = hasFlag(rawArgs, 'scope')
  const wantsAll = Boolean(args.all)

  if (explicitScope) {
    return parsePluginInstallScopeSelector(String(args.scope))
  }

  if (wantsAll) {
    return 'auto'
  }

  const scopes = [...new Set(records.map((record) => record.scope))]
  if (scopes.length <= 1) {
    return scopes[0] ?? 'auto'
  }

  if (!interactive) {
    throw new Error('Multiple install scopes match. Re-run with `--scope personal`, `--scope workspace`, or `--all`.')
  }

  const selected = await selectOption(
    ['auto', ...scopes] as const,
    (scope) => (scope === 'auto' ? 'All matching scopes' : scope),
    'Select a scope'
  )
  return selected
}

function printUninstallPlan(records: PluginInstallRecord[]) {
  console.log('Uninstall plan:')
  const providers = [...new Set(records.map((record) => record.provider))].join(', ')
  const scopes = [...new Set(records.map((record) => record.scope))].join(', ')
  console.log(`  providers: ${providers}`)
  console.log(`  scopes: ${scopes}`)
  console.log(`  packs: ${records.map((record) => record.packName).join(', ')}`)

  for (const record of records) {
    console.log(`${record.provider} [${record.scope}] ${record.pluginName}`)
    for (const targetPath of record.targetPaths) {
      console.log(`  -> ${targetPath}`)
    }
  }
}

const command = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove AgentRig-managed plugins using the install ledger.',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Provider to uninstall for: claude, codex, cursor, or all',
    },
    all: {
      type: 'boolean',
      description: 'Allow uninstalling all matching packs and/or all providers.',
      default: false,
    },
    pack: {
      type: 'string',
      description: 'Pack name to uninstall. Matches either the pack name or plugin name.',
    },
    scope: {
      type: 'string',
      description: 'Install scope selector: auto, personal, or workspace',
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
  async run({ args, rawArgs }) {
    if (args.help) return showUsage(command)

    const cwd = process.cwd()
    const ledgers = await loadPluginInstallLedgers(cwd)
    const allRecords = listPluginInstallRecords(ledgers)
    if (allRecords.length === 0) {
      throw new Error('No AgentRig-managed plugin installs were found.')
    }

    const provider = await resolveProviderSelection(rawArgs, args, allRecords)
    const providerScopedRecords =
      provider === 'all' ? allRecords : allRecords.filter((record) => record.provider === provider)
    if (providerScopedRecords.length === 0) {
      throw new Error('No installed plugins matched the selected provider.')
    }

    const pack = await resolvePackSelection(rawArgs, args, providerScopedRecords)
    const packScopedRecords = pack
      ? providerScopedRecords.filter((record) => record.packName === pack || record.pluginName === pack)
      : providerScopedRecords
    if (packScopedRecords.length === 0) {
      throw new Error(`No installed plugins matched pack "${pack}".`)
    }

    const scopeSelector = await resolveScopeSelection(rawArgs, args, packScopedRecords)
    const scopeScopedRecords =
      scopeSelector === 'auto'
        ? packScopedRecords
        : packScopedRecords.filter((record) => record.scope === scopeSelector)
    if (scopeScopedRecords.length === 0) {
      throw new Error('No installed plugins matched the selected scope.')
    }

    const uniqueScopeKeys = new Set(scopeScopedRecords.map((record) => `${record.provider}:${record.scope}:${record.packName}`))
    if (!args.all && !hasFlag(rawArgs, 'scope') && uniqueScopeKeys.size > 1 && !isInteractiveTty()) {
      throw new Error('Multiple matching installs were found. Re-run with `--all` or narrow the selection.')
    }

    printUninstallPlan(scopeScopedRecords)

    const results = await uninstallPluginProviders(scopeScopedRecords, {
      cwd,
      dryRun: args.dryRun,
    })

    for (const result of results) {
      console.log(`${result.provider}: removed ${result.removed.length}, kept ${result.kept.length}, missing ${result.missing.length}`)
      for (const location of result.locations) {
        console.log(`  -> ${location}`)
      }
    }
  },
})

export default command
