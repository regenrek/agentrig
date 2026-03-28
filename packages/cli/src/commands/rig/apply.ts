import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'
import {
  cleanupMaterializedPack,
  materializeResolvedPackGraph,
  resolvePackGraph,
  type ResolvedPackGraph,
} from '../../lib/plugin-consumer'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../lib/plugin-install-ledger'
import {
  buildResolvedPackSpecIdentityMap,
  getPluginInstallSpecIdentityKey,
} from '../../lib/plugin-install-spec'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
  uninstallPluginProviders,
} from '../../lib/plugin-providers'
import { determineTrustTier, requiresConfirmation } from '../../lib/trust'
import type { ResolvedPack } from '../../lib/registry'

function resolveRigPacks(
  rigs: Record<string, { extends?: string[]; packs?: string[] }>,
  rigName: string,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(rigName)) return []
  seen.add(rigName)

  const rig = rigs[rigName]
  if (!rig) throw new Error(`Unknown rig: ${rigName}`)

  const result: string[] = []

  for (const parent of rig.extends ?? []) {
    result.push(...resolveRigPacks(rigs, parent, seen))
  }
  for (const p of rig.packs ?? []) result.push(p)

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
    description: 'Remove installed packs that are not part of the rig',
    default: true,
  },
  dryRun: {
    type: 'boolean',
    description: 'Show what would happen without writing files or invoking provider CLIs.',
    default: false,
  },
  yes: {
    type: 'boolean',
    alias: 'y',
    description: 'Skip confirmation prompts for unlisted sources.',
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

function mergePackGraphs(graphs: ResolvedPackGraph[]) {
  const ordered: ResolvedPack[] = []
  const visitKeys = new Set<string>()
  const sourcesByPackName = new Map<string, string>()

  for (const graph of graphs) {
    for (const resolved of graph.resolvedPacks) {
      const visitKey = `${resolved.sourceLabel}:${resolved.meta.name}`
      if (visitKeys.has(visitKey)) continue

      const existingSource = sourcesByPackName.get(resolved.meta.name)
      if (existingSource && existingSource !== resolved.sourceLabel) {
        throw new Error(
          `Rig resolves pack "${resolved.meta.name}" from multiple sources (${existingSource}, ${resolved.sourceLabel}). Use one canonical source per pack name.`
        )
      }

      visitKeys.add(visitKey)
      sourcesByPackName.set(resolved.meta.name, resolved.sourceLabel)
      ordered.push(resolved)
    }
  }

  return ordered
}

const command = defineCommand({
  meta: {
    name: 'apply',
    description: 'Apply a rig by installing its pack specs as provider plugins.',
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

    const packSpecs = resolveRigPacks(cfg.rigs, rigName)
    if (!packSpecs.length) {
      console.log(`Rig "${rigName}" has no packs.`)
      return
    }

    const scope = args.scope
      ? parsePluginInstallScopeSelector(String(args.scope))
      : 'auto'

    console.log(`Applying rig: ${rigName}`)
    console.log(`provider: ${provider}`)
    console.log(`pack specs: ${packSpecs.join(', ')}`)
    console.log('')

    const graphs: ResolvedPackGraph[] = []
    for (const packSpec of packSpecs) {
      graphs.push(await resolvePackGraph(packSpec, cwd, cfg.registries))
    }
    const resolvedPacks = mergePackGraphs(graphs)
    const unlistedPacks: string[] = []
    for (const resolved of resolvedPacks) {
      const trustTier = resolved.trustTier ?? await determineTrustTier(
        resolved.source.type === 'url' ? resolved.source.baseUrl : resolved.sourceLabel,
        cfg.registries
      )
      if (requiresConfirmation(trustTier)) {
        unlistedPacks.push(resolved.meta.name)
      }
    }
    if (unlistedPacks.length > 0 && !args.yes) {
      throw new Error(
        `This rig includes pack(s) from unlisted sources: ${unlistedPacks.join(', ')}.\n` +
          'Re-run with --yes to confirm install.'
      )
    }

    const materialized = await materializeResolvedPackGraph({
      requestedPack: graphs[0]!.requestedPack,
      resolvedPacks,
    })
    const specIdentitiesByPackName = buildResolvedPackSpecIdentityMap(resolvedPacks)

    try {
      const plan = await preparePluginInstall({
        cwd,
        agent: provider,
        packsDir: materialized.packsRoot,
        specIdentitiesByPackName,
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
          Object.values(specIdentitiesByPackName).map((identity) =>
            getPluginInstallSpecIdentityKey(identity)
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
            `Pruning ${toRemove.length} plugin install(s): ${toRemove.map((record) => record.packName).join(', ')}`
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
      await cleanupMaterializedPack(materialized.packsRoot)
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
