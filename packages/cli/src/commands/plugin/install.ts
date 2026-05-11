import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  resolvePluginGraph,
} from '../../lib/plugin-consumer'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
} from '../../lib/plugin-providers'
import { resolveInstallScope } from '../../lib/plugin-providers/shared'
import { selfHealClaudeInstalls } from '../../lib/plugin-providers/claude-self-heal'
import { assertCodexPluginPersonalScope } from '../../lib/plugin-providers/codex'
import { buildResolvedPluginInstallMetadataMap } from '../../lib/plugin-install-spec'
import { listPluginInstallRecords, loadPluginInstallLedgers } from '../../lib/plugin-install-ledger'
import { parseRegistryPluginSpec } from '../../lib/registry-spec'
import { pathExists } from '../../lib/fs'

function printInstallPlanSummary(plan: Awaited<ReturnType<typeof preparePluginInstall>>) {
  console.log('Install plan:')
  console.log(`  plugins: ${plan.plugins.map((plugin) => plugin.manifest.name).join(', ')}`)
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

const knownInstallFlags = new Set([
  '--cwd',
  '--scope',
  '--force',
  '--dry-run',
  '--no-enable',
  '--help',
])

function assertKnownInstallFlags(rawArgs: string[] | undefined) {
  if (!rawArgs) return
  for (const arg of rawArgs) {
    if (arg === '--') return
    if (!arg.startsWith('--')) continue

    const flag = arg.split('=', 1)[0]
    if (!knownInstallFlags.has(flag)) {
      throw new Error(`Unknown option: ${flag}`)
    }
  }
}

const command = defineCommand({
  meta: {
    name: 'install',
    description: 'Install a resolved plugin as a Claude, Codex, or Cursor plugin.',
  },
  args: {
    provider: {
      type: 'positional',
      description: 'Provider to install for: claude, codex, or cursor',
      required: true,
    },
    spec: {
      type: 'positional',
      description: 'Canonical install ref: <registryAlias>/<namespace.plugin>; add @<version> for an explicit pin',
      required: true,
    },
    cwd: {
      type: 'string',
      description: 'Working directory (defaults to current directory)',
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
    'no-enable': {
      type: 'boolean',
      description: 'Codex only: install the plugin but leave it disabled.',
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
    assertKnownInstallFlags(rawArgs)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const provider = parsePluginProviderSelector(String(args.provider))
    if (provider === 'all') {
      throw new Error('`agentrig plugin install` requires a single provider.')
    }

    const scope = args.scope
      ? parsePluginInstallScopeSelector(String(args.scope))
      : 'auto'

    if (provider === 'codex') {
      assertCodexPluginPersonalScope(resolveInstallScope(provider, scope))
    }

    // Heal pre-0.7.4 Claude installs whose marketplace source path is stale
    // (typically `/tmp/agentrig-plugins-*`) before we make install decisions.
    const heal = await selfHealClaudeInstalls(cwd)
    for (const entry of heal.patchedLedgerEntries) {
      console.log(
        `[self-heal] Claude install ${entry.id}: marketplace source ${entry.previousSource} -> ${entry.nextSource}`
      )
    }
    for (const warning of heal.warnings) {
      console.warn(`[self-heal] ${warning}`)
    }

    if (!args.force) {
      const alreadyInstalled = await detectAlreadyInstalled({
        cwd,
        provider,
        spec: String(args.spec),
        scope,
      })
      if (alreadyInstalled) {
        console.log(
          `Already installed: ${alreadyInstalled.pluginId}@${alreadyInstalled.pluginVersion} ` +
          `(${alreadyInstalled.provider}, ${alreadyInstalled.scope}) at ${alreadyInstalled.installPath}.`
        )
        console.log('Use --force to reinstall.')
        return
      }
    }

    const cfg = await loadConfig(cwd)
    const graph = await resolvePluginGraph(String(args.spec), cwd, cfg.registries)

    const materialized = await materializeResolvedPluginGraph(graph)
    const installMetadataByPluginId = buildResolvedPluginInstallMetadataMap(graph.resolvedPlugins)

    try {
      const plan = await preparePluginInstall({
        cwd,
        agent: provider,
        pluginsDir: materialized.pluginsRoot,
        installMetadataByPluginId,
        scope,
        force: args.force,
        dryRun: args.dryRun,
        enable: !rawArgs?.includes('--no-enable'),
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
    } finally {
      await cleanupMaterializedPlugin(materialized.pluginsRoot)
    }
  },
})

/**
 * Pre-flight: skip the heavy resolve/materialize/install pipeline when the
 * requested plugin is already installed for this provider/scope and matches
 * the canonical pluginId. Returns the matching ledger record summary or null.
 *
 * Note: matching is intentionally pluginId-only (not version-aware) so that
 * `agentrig plugin install <provider> <pluginId>` without `--force` is always
 * a graceful no-op when the plugin is present, regardless of installed
 * version. `--force` reinstalls and updates the version if needed.
 */
async function detectAlreadyInstalled(params: {
  cwd: string
  provider: 'claude' | 'codex' | 'cursor'
  spec: string
  scope: 'auto' | 'personal' | 'workspace'
}): Promise<
  | {
      provider: string
      scope: string
      pluginId: string
      pluginVersion: string
      installPath: string
    }
  | null
> {
  let parsed: ReturnType<typeof parseRegistryPluginSpec>
  try {
    parsed = parseRegistryPluginSpec(params.spec.trim())
  } catch {
    return null
  }
  const ledgers = await loadPluginInstallLedgers(params.cwd)
  const records = listPluginInstallRecords(ledgers, params.scope)
  const targetScope = resolveInstallScope(params.provider, params.scope)
  const match = records.find(
    (record) =>
      record.provider === params.provider &&
      record.pluginId === parsed.plugin &&
      record.scope === targetScope
  )
  if (!match) return null

  // Quick sanity check: if the recorded install path no longer exists on disk,
  // the install is stale (e.g. the user manually deleted the directory or it
  // was a /tmp staging path that got cleaned). Don't claim "already installed".
  const installPath = match.targetPaths[0]
  if (installPath && !(await pathExists(installPath))) {
    return null
  }
  return {
    provider: match.provider,
    scope: match.scope,
    pluginId: match.pluginId,
    pluginVersion: match.pluginVersion,
    installPath: installPath ?? '<unknown>',
  }
}

export default command
