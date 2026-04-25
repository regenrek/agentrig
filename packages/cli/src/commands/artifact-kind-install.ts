import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import type { SelectableArtifactKind } from '@agentrig/sdk'
import { loadAuthSession } from '../lib/auth'
import {
  createArtifactSubmission,
  resolveCommunityBaseUrl,
} from '../lib/community-api'
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
import {
  installArtifactSelection,
  uninstallArtifactSelection,
} from '../lib/artifact-selection-install'
import { listRepeatedOptionValues } from '../lib/repeated-options'

type SubmittableArtifactKind = Extract<SelectableArtifactKind, 'skill' | 'mcp' | 'hook'>

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
        description: 'Signed registry plugin ref: <registryAlias>/<namespace.plugin>@<version>',
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
      if (picks.length === 0) {
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
      upstreamRepo: {
        type: 'string',
        description: 'Canonical upstream_repo, for example https://github.com/owner/repo',
      },
      upstreamTag: {
        type: 'string',
        description: 'Canonical upstream_tag, for example v1.2.3',
      },
      upstreamCommitSha: {
        type: 'string',
        description: 'Canonical upstream_commit_sha (full 40-character commit SHA)',
      },
      artifactPath: {
        type: 'string',
        description: 'Canonical artifact_path relative to the repo root',
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
      if (!args.upstreamRepo || !args.upstreamTag || !args.upstreamCommitSha || !args.artifactPath) {
        throw new Error(
          `Canonical ${kind} submission requires --upstreamRepo, --upstreamTag, --upstreamCommitSha, and --artifactPath.`
        )
      }
      const baseUrl = resolveCommunityBaseUrl(args.baseUrl, session.baseUrl)
      const created = await createArtifactSubmission(baseUrl, session.accessToken, {
        kind,
        upstream_repo: args.upstreamRepo,
        upstream_tag: args.upstreamTag,
        upstream_commit_sha: args.upstreamCommitSha,
        artifact_path: args.artifactPath,
      })
      console.log(`Submission: ${created.submissionId}`)
      if (created.deduped) console.log('Result: existing submission reused')
      console.log(`${kind} submission recorded for validation and review`)
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
      if (picks.length === 0) {
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
