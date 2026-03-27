import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { hasFlag, isInteractiveTty } from '../../lib/command-ui'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
  type PluginInstallScopeSelector,
  type PluginProviderSelector,
} from '../../lib/plugin-providers'
import { buildPackEntries, loadPluginConfig } from '../../lib/plugin-providers/shared'
import { selectOption } from '../../lib/interactive'

async function resolveProviderSelection(
  rawArgs: string[] | undefined,
  args: Record<string, unknown>
): Promise<PluginProviderSelector> {
  const interactive = isInteractiveTty()
  const explicitAgent = hasFlag(rawArgs, 'agent')
  const wantsAll = Boolean(args.all)

  if (explicitAgent) {
    const provider = parsePluginProviderSelector(String(args.agent))
    if (provider === 'all' && !wantsAll) {
      throw new Error('Installing across all providers requires `--all`.')
    }
    return provider
  }

  if (wantsAll) {
    return 'all'
  }

  if (!interactive) {
    throw new Error('Non-interactive installs require `--agent <provider>` or `--all`.')
  }

  return selectOption(
    ['claude', 'codex', 'cursor', 'all'] as const,
    (provider) => (provider === 'all' ? 'All providers' : provider),
    'Select a provider'
  )
}

async function resolvePackSelection(
  cwd: string,
  rawArgs: string[] | undefined,
  args: Record<string, unknown>
) {
  const interactive = isInteractiveTty()
  const explicitPack = hasFlag(rawArgs, 'pack')
  const wantsAll = Boolean(args.all)

  if (explicitPack) {
    return String(args.pack)
  }

  if (wantsAll) {
    return undefined
  }

  if (!interactive) {
    throw new Error('Non-interactive installs require `--pack <folder>` or `--all`.')
  }

  const cfg = await loadPluginConfig(cwd, args.config ? String(args.config) : undefined, {
    marketplaceName: args.marketplaceName ? String(args.marketplaceName) : undefined,
    ownerName: args.ownerName ? String(args.ownerName) : undefined,
    ownerEmail: args.ownerEmail ? String(args.ownerEmail) : undefined,
    pluginPrefix: args.pluginPrefix ? String(args.pluginPrefix) : undefined,
  })
  const packs = await buildPackEntries(path.resolve(cwd, String(args.packsDir)), cfg.pluginPrefix)
  const selection = await selectOption(
    ['__all__', ...packs.map((pack) => pack.packDir.split(path.sep).at(-1) ?? pack.meta.name)],
    (item) => {
      if (item === '__all__') return 'All packs'
      const pack = packs.find((candidate) => candidate.packDir.split(path.sep).at(-1) === item)
      return pack ? `${item} (${pack.meta.title})` : item
    },
    'Select a pack'
  )
  return selection === '__all__' ? undefined : selection
}

async function resolveScopeSelection(rawArgs: string[] | undefined, args: Record<string, unknown>) {
  const interactive = isInteractiveTty()
  const explicitScope = hasFlag(rawArgs, 'scope')

  if (explicitScope) {
    return parsePluginInstallScopeSelector(String(args.scope))
  }

  if (!interactive) {
    return 'auto' satisfies PluginInstallScopeSelector
  }

  return selectOption(
    ['auto', 'workspace', 'personal'] as const,
    (scope) => {
      if (scope === 'auto') return 'auto (recommended)'
      return scope
    },
    'Select an install scope'
  )
}

function printInstallPlanSummary(plan: Awaited<ReturnType<typeof preparePluginInstall>>) {
  console.log('Install plan:')
  console.log(`  packs: ${plan.packs.map((pack) => pack.meta.name).join(', ')}`)
  console.log(`  requested scope: ${plan.requestedScope}`)

  for (const provider of plan.providers) {
    console.log(`${provider.provider} [${provider.scope}]`)
    for (const location of provider.preview.locations) {
      console.log(`  -> ${location}`)
    }
    for (const action of provider.preview.actions) {
      console.log(`  * ${action}`)
    }
  }
}

const command = defineCommand({
  meta: {
    name: 'install',
    description: 'Install exported pack plugins into Claude, Codex, Cursor, or all supported providers.',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Provider to install for: claude, codex, cursor, or all',
    },
    all: {
      type: 'boolean',
      description: 'Allow installing all discovered packs and/or all providers.',
      default: false,
    },
    packsDir: {
      type: 'string',
      description: 'Directory containing pack folders (each with meta.json).',
      default: 'registry/packs',
    },
    out: {
      type: 'string',
      description: 'Optional export directory to keep after installation. Defaults to a temporary directory.',
    },
    config: {
      type: 'string',
      description: 'Optional config file (defaults to agentrig.plugins.json).',
    },
    marketplaceName: {
      type: 'string',
      description: 'Override the marketplace identifier for the selected provider(s).',
    },
    ownerName: {
      type: 'string',
      description: 'Marketplace owner name.',
    },
    ownerEmail: {
      type: 'string',
      description: 'Marketplace owner email (optional).',
    },
    pluginPrefix: {
      type: 'string',
      description: 'Prefix applied to plugin names to avoid collisions.',
    },
    pack: {
      type: 'string',
      description: 'Install a single pack by folder name instead of every pack.',
    },
    scope: {
      type: 'string',
      description: 'Install scope selector: auto, personal, or workspace',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite installed plugin directories if they already exist.',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Show what would be installed without writing files or invoking provider CLIs.',
      default: false,
    },
    clean: {
      type: 'boolean',
      description: 'Remove the explicit output directory before exporting into it.',
      default: true,
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
    const provider = await resolveProviderSelection(rawArgs, args)
    const pack = await resolvePackSelection(cwd, rawArgs, args)
    const scope = await resolveScopeSelection(rawArgs, args)
    const plan = await preparePluginInstall({
      cwd,
      agent: provider,
      packsDir: String(args.packsDir),
      out: args.out ? path.resolve(cwd, args.out) : undefined,
      configPath: args.config,
      marketplaceName: args.marketplaceName,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      pluginPrefix: args.pluginPrefix,
      pack,
      scope,
      force: args.force,
      dryRun: args.dryRun,
      clean: args.clean,
    })

    printInstallPlanSummary(plan)

    const results = await installPreparedPluginProviders(plan)

    for (const result of results) {
      console.log(
        `${result.provider} [${result.scope}]: installed ${result.installed.length}, skipped ${result.skipped.length}`
      )
      for (const location of result.locations) {
        console.log(`  -> ${location}`)
      }
    }
  },
})

export default command
