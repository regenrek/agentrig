import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  resolvePluginGraph,
} from '../lib/plugin-consumer'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  resolveInstallScope,
} from '../lib/plugin-providers'
import { assertInstallableTrust } from '../lib/trust'
import { installArtifactSelection } from '../lib/artifact-selection-install'
import { listRepeatedOptionValues } from '../lib/repeated-options'

const command = defineCommand({
  meta: {
    name: 'install',
    description: 'Install a selected artifact bundle from a signed registry plugin.',
  },
  args: {
    provider: {
      type: 'positional',
      description: 'Provider to install for: claude, codex, or cursor',
      required: true,
    },
    source: {
      type: 'positional',
      description: 'Signed registry plugin ref: <registryAlias>/<namespace.plugin>@<version>',
      required: true,
    },
    pick: {
      type: 'string',
      description: 'Artifact selector to install, for example skill:review. Repeat for multiple artifacts.',
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
      description: 'Overwrite existing AgentRig-owned target files or JSON keys when safe.',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Show what would be installed without writing files.',
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
    const picks = listRepeatedOptionValues(args.pick, rawArgs, 'pick')
    if (picks.length === 0) {
      throw new Error('Selection install requires at least one --pick kind:name value.')
    }

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const provider = parsePluginProviderSelector(String(args.provider))
    if (provider === 'all') {
      throw new Error('`agentrig install` requires a single provider.')
    }
    const requestedScope = args.scope
      ? parsePluginInstallScopeSelector(String(args.scope))
      : 'auto'
    const scope = resolveInstallScope(provider, requestedScope)

    const cfg = await loadConfig(cwd)
    const graph = await resolvePluginGraph(String(args.source), cwd, cfg.registries)
    for (const resolved of graph.resolvedPlugins) {
      assertInstallableTrust(
        resolved.manifest.id,
        resolved.manifest.version,
        resolved.trustTier,
        resolved.installability
      )
    }

    const materialized = await materializeResolvedPluginGraph(graph)
    try {
      const result = await installArtifactSelection({
        cwd,
        provider,
        requestedScope,
        scope,
        registryRef: String(args.source),
        resolved: graph.requestedPlugin,
        pluginDir: materialized.pluginDir,
        picks,
        force: args.force,
        dryRun: args.dryRun,
      })

      console.log('Selection install:')
      console.log(`  selection: ${result.bundle.selectionId}`)
      console.log(`  provider: ${provider}`)
      console.log(`  scope: ${scope}`)
      console.log(`  root: ${result.rootDir}`)
      for (const selector of result.record.selectedSelectors) {
        console.log(`  - ${selector}`)
      }
      for (const targetPath of result.record.targetPaths) {
        console.log(`  -> ${targetPath}`)
      }
      for (const warning of result.bundle.materialization.warnings) {
        console.warn(`Warning: ${warning}`)
      }
    } finally {
      await cleanupMaterializedPlugin(materialized.pluginsRoot)
    }
  },
})

export default command
