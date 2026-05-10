import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import type { CliSupportedKind } from '@agentrig/sdk'
import { loadAuthSession } from '../lib/auth'
import {
  createPluginSubmission,
  resolveAuthenticatedCommunityBaseUrl,
} from '../lib/community-api'
import { loadConfig } from '../lib/config'
import {
  cleanupMaterializedPlugin,
  materializeResolvedStandaloneArtifact,
  materializeResolvedPluginGraph,
  resolvePluginGraph,
} from '../lib/plugin-consumer'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  resolveInstallScope,
} from '../lib/plugin-providers'
import { parseRegistryArtifactSpec } from '../lib/registry-spec'
import { resolveStandaloneArtifact } from '../lib/registry'
import {
  installArtifactSelection,
  uninstallArtifactSelection,
} from '../lib/artifact-selection-install'
import { listRepeatedOptionValues } from '../lib/repeated-options'
import { resolveSubmitSource } from '../lib/submit-source'

type SubmittableArtifactKind = Extract<CliSupportedKind, 'skill' | 'mcp' | 'hook'>

export function createArtifactKindCommand(kind: SubmittableArtifactKind) {
  const install = defineCommand({
    meta: {
      name: 'install',
      description: `Install selected ${kind} artifact(s) from a signed registry plugin.`,
    },
    args: {
      provider: {
        type: 'positional',
        description: 'Provider to install for: claude, codex, or cursor',
        required: true,
      },
      source: {
        type: 'positional',
        description: `Signed registry ${kind} or plugin ref: <registryAlias>/<namespace.${kind}>; add @<version> for an explicit pin`,
        required: true,
      },
      pick: {
        type: 'string',
        description: `Artifact name to install. Repeat for multiple ${kind}s.`,
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
      if (args.help) return showUsage(install)
      const picks = listRepeatedOptionValues(args.pick, rawArgs, 'pick')
      if (picks.length === 0 && kind !== 'skill') {
        throw new Error(`${kind} install requires at least one --pick value.`)
      }

      const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
      const provider = parsePluginProviderSelector(String(args.provider))
      if (provider === 'all') {
        throw new Error(`agentrig ${kind} install requires a single provider.`)
      }
      const requestedScope = args.scope
        ? parsePluginInstallScopeSelector(String(args.scope))
        : 'auto'
      const scope = resolveInstallScope(provider, requestedScope)
      const cfg = await loadConfig(cwd)
      if (picks.length === 0) {
        const spec = parseRegistryArtifactSpec(String(args.source), kind)
        const resolved = await resolveStandaloneArtifact(
          spec.registry,
          spec.artifactKind,
          spec.artifact,
          spec.version,
          cfg.registries
        )
        const materialized = await materializeResolvedStandaloneArtifact(resolved)
        try {
          const result = await installArtifactSelection({
            sourceKind: 'registry-artifact',
            cwd,
            provider,
            requestedScope,
            scope,
            registryRef: String(args.source),
            resolved,
            pluginDir: materialized.artifactDir,
            force: args.force,
            dryRun: args.dryRun,
          })
          console.log(`${kind} standalone install: ${result.bundle.selectionId}`)
          for (const selector of result.record.selectedSelectors) console.log(`  - ${selector}`)
          for (const targetPath of result.record.targetPaths) console.log(`  -> ${targetPath}`)
          for (const warning of result.bundle.materialization.warnings) console.warn(`Warning: ${warning}`)
        } finally {
          await cleanupMaterializedPlugin(materialized.artifactsRoot)
        }
        return
      }

      const graph = await resolvePluginGraph(String(args.source), cwd, cfg.registries)

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
          defaultKind: kind,
          force: args.force,
          dryRun: args.dryRun,
        })
        console.log(`${kind} selection install: ${result.bundle.selectionId}`)
        for (const selector of result.record.selectedSelectors) console.log(`  - ${selector}`)
        for (const targetPath of result.record.targetPaths) console.log(`  -> ${targetPath}`)
        for (const warning of result.bundle.materialization.warnings) console.warn(`Warning: ${warning}`)
      } finally {
        await cleanupMaterializedPlugin(materialized.pluginsRoot)
      }
    },
  })

  const submit = defineCommand({
    meta: {
      name: 'submit',
      description: `Submit one canonical upstream ${kind} artifact snapshot for review.`,
    },
    args: {
      baseUrl: {
        type: 'string',
        description: 'AgentRig web base URL (defaults to stored login, AGENTRIG_BASE_URL, or https://agentrig.ai)',
      },
      source: {
        type: 'positional',
        description: `Local ${kind} path, GitHub owner/repo@tag, or GitHub URL`,
      },
      version: {
        type: 'string',
        description: 'Artifact version used to resolve v<version> or <version> tags when the source has no tag',
      },
      path: {
        type: 'string',
        description: `${kind} path inside the source repo when it cannot be inferred from the source`,
      },
      dryRun: {
        type: 'boolean',
        description: 'Print the canonical submit payload without creating a review request.',
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
      if (args.help) return showUsage(submit)
      const session = await loadAuthSession()
      if (!session) {
        throw new Error('Not logged in. Run `agentrig login` first.')
      }
      if (!args.source) throw new Error(`Submit source required. Use a local path, owner/repo@tag, or GitHub URL.`)
      const baseUrl = resolveAuthenticatedCommunityBaseUrl(args.baseUrl, session.baseUrl)
      const payload = await resolveSubmitSource({
        source: String(args.source),
        version: typeof args.version === 'string' ? args.version : undefined,
        path: typeof args.path === 'string' ? args.path : undefined,
      })

      if (args.dryRun) {
        console.log('Submission type: canonical upstream review')
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      const created = await createPluginSubmission(baseUrl, session.accessToken, payload)
      console.log(`Submission: ${created.submissionId}`)
      console.log('Submission type: canonical upstream review')
      if (created.deduped) console.log('Result: existing submission reused')
      console.log(`${kind} submission recorded through canonical plugin review`)
    },
  })

  const uninstall = defineCommand({
    meta: {
      name: 'uninstall',
      description: `Uninstall an AgentRig-managed ${kind} Selection Bundle.`,
    },
    args: {
      provider: {
        type: 'positional',
        description: 'Provider to uninstall from: claude, codex, or cursor',
        required: true,
      },
      source: {
        type: 'positional',
        description: 'Signed registry plugin ref used during install',
        required: true,
      },
      pick: {
        type: 'string',
        description: `Artifact name to uninstall. Repeat for multiple ${kind}s.`,
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
        description: 'Show what would be removed without deleting files or JSON keys.',
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
      if (args.help) return showUsage(uninstall)
      const picks = listRepeatedOptionValues(args.pick, rawArgs, 'pick')
      if (picks.length === 0 && kind !== 'skill') {
        throw new Error(`${kind} uninstall requires at least one --pick value.`)
      }
      const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
      const provider = parsePluginProviderSelector(String(args.provider))
      if (provider === 'all') {
        throw new Error(`agentrig ${kind} uninstall requires a single provider.`)
      }
      const scope = args.scope ? parsePluginInstallScopeSelector(String(args.scope)) : undefined
      if (scope === 'auto') {
        throw new Error(`Use --scope personal or --scope workspace when narrowing ${kind} uninstalls.`)
      }
      const cfg = await loadConfig(cwd)
      const result = await uninstallArtifactSelection({
        sourceKind: picks.length === 0 ? 'registry-artifact' : 'registry-plugin',
        cwd,
        provider,
        source: String(args.source),
        registries: cfg.registries,
        picks,
        defaultKind: kind,
        scope,
        dryRun: args.dryRun,
      })
      console.log(`${kind} selection uninstall:`)
      console.log(`  removed: ${result.removed.length}`)
      console.log(`  kept: ${result.kept.length}`)
      console.log(`  missing: ${result.missing.length}`)
    },
  })

  const command = defineCommand({
    meta: {
      name: kind,
      description: `Work with ${kind} artifacts.`,
    },
    subCommands: { install, uninstall, submit },
    async run({ args, rawArgs }) {
      if (args.help || rawArgs.length === 0) return showUsage(command)
    },
  })
  return command
}
