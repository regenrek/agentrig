import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'
import {
  cleanupMaterializedPack,
  materializeResolvedPackGraph,
  resolvePackGraph,
} from '../../lib/plugin-consumer'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
} from '../../lib/plugin-providers'
import { buildResolvedPackSpecIdentityMap } from '../../lib/plugin-install-spec'
import { determineTrustTier, requiresConfirmation } from '../../lib/trust'

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
    description: 'Install a resolved pack as a Claude, Codex, or Cursor plugin.',
  },
  args: {
    provider: {
      type: 'positional',
      description: 'Provider to install for: claude, codex, or cursor',
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
    const graph = await resolvePackGraph(String(args.spec), cwd, cfg.registries)
    const unlistedPacks = []
    for (const resolved of graph.resolvedPacks) {
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
        `This install includes pack(s) from unlisted sources: ${unlistedPacks.join(', ')}.\n` +
          'Re-run with --yes to confirm install.'
      )
    }

    const materialized = await materializeResolvedPackGraph(graph)
    const specIdentitiesByPackName = buildResolvedPackSpecIdentityMap(graph.resolvedPacks)

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
    } finally {
      await cleanupMaterializedPack(materialized.packsRoot)
    }
  },
})

export default command
