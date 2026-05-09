import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  resolvePluginGraph,
  type ResolvedPluginGraph,
} from '../../lib/plugin-consumer'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../lib/plugin-install-ledger'
import {
  buildResolvedPluginInstallMetadataMap,
  getPluginInstallSpecIdentityKey,
} from '../../lib/plugin-install-spec'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
  uninstallPluginProviders,
} from '../../lib/plugin-providers'
import type { ResolvedPlugin } from '../../lib/registry'

function resolveRigPlugins(
  rigs: Record<string, { extends?: string[]; plugins?: string[] }>,
  rigName: string,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(rigName)) return []
  seen.add(rigName)

  const rig = rigs[rigName]
  if (!rig) throw new Error(`Unknown rig: ${rigName}`)

  const result: string[] = []

  for (const parent of rig.extends ?? []) {
    result.push(...resolveRigPlugins(rigs, parent, seen))
  }
  for (const p of rig.plugins ?? []) result.push(p)

  // de-dupe while preserving order
  const out: string[] = []
  const set = new Set<string>()
  for (const p of result) {
    if (set.has(p)) continue
    set.add(p)
    out.push(p)
  }
  return out
}

const args = {
  provider: {
    type: 'positional',
    description: 'Provider to install for: claude, codex, or cursor',
    required: true,
  },
  name: {
    type: 'positional',
    description: 'Rig name to apply (defaults to config.defaultRig)',
    required: false,
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
    description: 'Overwrite files if they already exist',
    default: false,
  },
  prune: {
    type: 'boolean',
    description: 'Remove installed plugins that are not part of the rig',
    default: true,
  },
  dryRun: {
    type: 'boolean',
    description: 'Show what would happen without writing files or invoking provider CLIs.',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

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

function mergePluginGraphs(graphs: ResolvedPluginGraph[]) {
  const ordered: ResolvedPlugin[] = []
  const visitKeys = new Set<string>()
  const sourcesByPluginId = new Map<string, string>()

  for (const graph of graphs) {
    for (const resolved of graph.resolvedPlugins) {
      const sourceLabel = `${resolved.listing.slug ?? resolved.listing.artifactId}@${resolved.listing.version}`
      const visitKey = `${sourceLabel}:${resolved.listing.artifactId}`
      if (visitKeys.has(visitKey)) continue

      const existingSource = sourcesByPluginId.get(resolved.listing.artifactId)
      if (existingSource && existingSource !== sourceLabel) {
        throw new Error(
          `Rig resolves plugin "${resolved.listing.artifactId}" from multiple sources (${existingSource}, ${sourceLabel}). Use one canonical source per plugin id.`
        )
      }

      visitKeys.add(visitKey)
      sourcesByPluginId.set(resolved.listing.artifactId, sourceLabel)
      ordered.push(resolved)
    }
  }

  return ordered
}

const command = defineCommand({
  meta: {
    name: 'apply',
    description: 'Apply a rig by installing its plugin specs as provider plugins.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)
    const provider = parsePluginProviderSelector(String(args.provider))
    if (provider === 'all') {
      throw new Error('`agentrig rig apply` requires a single provider.')
    }

    const rigName = args.name ?? cfg.defaultRig
    if (!rigName) throw new Error('No rig name provided and config.defaultRig is not set.')

    const pluginSpecs = resolveRigPlugins(cfg.rigs, rigName)
    if (!pluginSpecs.length) {
      console.log(`Rig "${rigName}" has no plugins.`)
      return
    }

    const scope = args.scope
      ? parsePluginInstallScopeSelector(String(args.scope))
      : 'auto'

    console.log(`Applying rig: ${rigName}`)
    console.log(`provider: ${provider}`)
    console.log(`plugin specs: ${pluginSpecs.join(', ')}`)
    console.log('')

    const graphs: ResolvedPluginGraph[] = []
    for (const pluginSpec of pluginSpecs) {
      graphs.push(await resolvePluginGraph(pluginSpec, cwd, cfg.registries))
    }
    const resolvedPlugins = mergePluginGraphs(graphs)

    const materialized = await materializeResolvedPluginGraph({
      requestedPlugin: graphs[0]!.requestedPlugin,
      resolvedPlugins,
    })
    const installMetadataByPluginId = buildResolvedPluginInstallMetadataMap(resolvedPlugins)

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

      const effectiveScope = plan.providers[0]?.scope
      if (args.prune && effectiveScope) {
        const want = new Set(
          Object.values(installMetadataByPluginId).map((entry) =>
            getPluginInstallSpecIdentityKey(entry.specIdentity)
          )
        )
        const ledgers = await loadPluginInstallLedgers(cwd)
        const allRecords = listPluginInstallRecords(ledgers, effectiveScope)
        const toRemove = allRecords.filter(
          (record) =>
            record.provider === provider &&
            !want.has(getPluginInstallSpecIdentityKey(record.specIdentity))
        )
        if (toRemove.length) {
          console.log('')
          console.log(
            `Pruning ${toRemove.length} plugin install(s): ${toRemove.map((record) => record.pluginId).join(', ')}`
          )
          const pruneResults = await uninstallPluginProviders(toRemove, {
            cwd,
            dryRun: args.dryRun,
          })
          for (const result of pruneResults) {
            console.log(
              `${result.provider}: removed ${result.removed.length}, kept ${result.kept.length}, missing ${result.missing.length}`
            )
            for (const location of result.locations) {
              console.log(`  -> ${location}`)
            }
          }
        }
      }
    } finally {
      await cleanupMaterializedPlugin(materialized.pluginsRoot)
    }

    if (!args.prune) {
      console.log('')
      console.log('Prune skipped.')
    }

    console.log('')
    console.log('Done.')
  },
})

export default command
