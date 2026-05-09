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
import { buildResolvedPluginInstallMetadataMap } from '../../lib/plugin-install-spec'

function printInstallPlanSummary(plan: Awaited<ReturnType<typeof preparePluginInstall>>) {
  console.log('Install plan:')
  console.log(`  plugins: ${plan.plugins.map((plugin) => plugin.manifest.id).join(', ')}`)
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
      throw new Error('`agentrig plugin install` requires a single provider.')
    }

    const scope = args.scope
      ? parsePluginInstallScopeSelector(String(args.scope))
      : 'auto'

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

export default command
