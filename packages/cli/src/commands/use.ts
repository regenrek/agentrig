import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { defineCommand, showUsage } from 'citty'
import { materializePlugin, scanRepo, type RepoScanSource, type Signal } from '@agentrig/sdk'
import { enrichWithLocalAi } from '../lib/enrich/local'
import { getAgentRigHome } from '../lib/paths'
import { installPluginProviders, parsePluginInstallScopeSelector, parsePluginProviderSelector } from '../lib/plugin-providers'
import { resolveRepoSource } from '../lib/repo-source'
import type { PluginInstallSpecIdentity } from '../lib/types'

const command = defineCommand({
  meta: {
    name: 'use',
    description: 'Pick repo signals and materialize them as an AgentRig plugin.',
  },
  args: {
    source: {
      type: 'positional',
      description: 'Local path, GitHub owner/repo, github:owner/repo, or GitHub URL',
      required: true,
    },
    ref: {
      type: 'string',
      description: 'Git ref for remote sources',
    },
    path: {
      type: 'string',
      description: 'Subdirectory to scan within the source',
    },
    'as-plugin': {
      type: 'string',
      description: 'Materialize picked signals as this plugin id',
    },
    provider: {
      type: 'string',
      description: 'Provider to install for: claude, codex, cursor, or all',
      default: 'all',
    },
    scope: {
      type: 'string',
      description: 'Install scope: personal, workspace, or auto',
      default: 'auto',
    },
    force: {
      type: 'boolean',
      description: 'Replace existing provider-local plugin files when allowed',
      default: false,
    },
    out: {
      type: 'string',
      description: 'Output plugin directory (default: ./<plugin-id>)',
    },
    pick: {
      type: 'string',
      description: 'Comma-separated signal source paths to pick',
    },
    yes: {
      type: 'boolean',
      alias: 'y',
      description: 'Pick all signals when --pick is omitted',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print planned files without writing',
      default: false,
    },
    'enrich-ai': {
      type: 'string',
      description: 'Opt in to local BYOK AI enrichment. Only "local" is supported.',
    },
    install: {
      type: 'boolean',
      description: 'Install picked signals through existing provider installers',
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
    const asPlugin = args['as-plugin']
    const dryRun = Boolean(args['dry-run'])
    const enrichAi = args['enrich-ai']

    if (!asPlugin && !args.install) {
      throw new Error('Missing required --as-plugin <id> or --install')
    }

    const resolved = await resolveRepoSource({
      source: String(args.source),
      ref: args.ref ? String(args.ref) : undefined,
      subdir: args.path ? String(args.path) : undefined,
    })
    try {
      const report = await scanRepo({ source: resolved.source, tree: resolved.tree })
      const pickedSignals = await pickSignals(report.signals, args.pick ? String(args.pick) : undefined, Boolean(args.yes))
      const enrichment = parseEnrichAiMode(enrichAi)
        ? await enrichWithLocalAi({
          input: {
            repoName: report.source.label,
            topLevelPaths: await getTopLevelPaths(resolved.tree),
            signals: report.signals.map((signal) => ({
              kind: signal.kind,
              id: signal.id,
              title: signal.title,
              description: signal.description,
              sourcePath: signal.sourcePath,
              providerCompat: signal.providerCompat,
            })),
            readmeExcerpt: await resolved.tree.readText('README.md') ?? undefined,
            fieldsToFill: asPlugin ? ['description', 'keywords'] : ['description', 'keywords', 'suggestedPluginId'],
          },
        })
        : undefined
      const pluginId = asPlugin ? String(asPlugin) : enrichment?.suggestedPluginId ?? deriveInstallPluginId(report.source.label)
      const files = await materializePlugin({
        tree: resolved.tree,
        pickedSignals,
        manifest: {
          id: pluginId,
          name: titleFromPluginId(pluginId),
          description: enrichment?.description ?? `AgentRig plugin generated from ${report.source.label}.`,
          version: '0.1.0',
          keywords: enrichment?.keywords,
          source: {
            ...sourceReferenceForManifest(report.source),
            ref: report.source.ref,
            commitSha: report.source.commitSha,
            subdir: report.source.subdir,
            scanDigest: report.digest,
          },
        },
      })
      const installRequested = Boolean(args.install)
      const outDir = installRequested
        ? path.join(resolveExternalCacheRoot(report.source.label, report.digest, report.source.commitSha || report.source.ref), 'plugins', pluginId)
        : path.resolve(args.out ? String(args.out) : path.join(process.cwd(), pluginId))

      if (dryRun) {
        console.log(`Plugin: ${pluginId}`)
        console.log(`Output: ${outDir}`)
        console.log(`Signals: ${pickedSignals.length}/${report.signals.length}`)
        for (const file of files) console.log(`- ${file.path}`)
        return
      }

      if (installRequested || args.force) {
        await fs.rm(outDir, { recursive: true, force: true })
      } else if (await pathExists(outDir)) {
        throw new Error(`Output directory already exists: ${outDir}. Re-run with --force to replace it.`)
      }
      await writeMaterializedFiles(outDir, files)
      if (installRequested) {
        const cacheRoot = path.dirname(path.dirname(outDir))
        const specIdentity = buildExternalRepoIdentity({
          pluginId,
          version: '0.1.0',
          sourceLabel: report.source.label,
          ref: report.source.ref,
          commitSha: report.source.commitSha,
          subdir: report.source.subdir,
          scanDigest: report.digest,
          pickedSignalPaths: pickedSignals.map((signal) => signal.sourcePath),
        })
        const results = await installPluginProviders({
          cwd: process.cwd(),
          agent: parsePluginProviderSelector(String(args.provider ?? 'all')),
          pluginsDir: path.dirname(outDir),
          out: path.join(cacheRoot, 'providers'),
          clean: true,
          scope: parsePluginInstallScopeSelector(String(args.scope ?? 'auto')),
          force: Boolean(args.force),
          dryRun: false,
          installMetadataByPluginId: {
            [pluginId]: {
              specIdentity,
              snapshotDigest: digestMaterializedFiles(files),
            },
          },
        })
        console.log(`Installed plugin: ${pluginId}`)
        for (const result of results) {
          console.log(`- ${result.provider} ${result.scope}: ${result.installed.join(', ') || 'no changes'}`)
        }
        return
      }
      console.log(`Plugin ready: ${outDir}`)
      console.log(`Signals: ${pickedSignals.length}/${report.signals.length}`)
      console.log(`Digest: ${report.digest}`)
    } finally {
      await resolved.cleanup()
    }
  },
})

async function pickSignals(signals: Signal[], pick: string | undefined, pickAll: boolean) {
  if (!pick) {
    if (!pickAll) return interactivePickSignals(signals)
    return signals
  }

  const wanted = new Set(pick.split(',').map((item) => item.trim()).filter(Boolean))
  const picked = signals.filter((signal) => wanted.has(signal.sourcePath))
  const missing = [...wanted].filter((sourcePath) => !picked.some((signal) => signal.sourcePath === sourcePath))
  if (missing.length) {
    throw new Error(`Unknown signal pick: ${missing.join(', ')}`)
  }
  return picked
}

async function interactivePickSignals(signals: Signal[]) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('No picks provided. Pass --pick <sourcePath,...> or --yes to pick all signals.')
  }
  if (!signals.length) throw new Error('No reusable signals found in source.')

  console.log('Select signals to use:')
  signals.forEach((signal, index) => {
    console.log(`${index + 1}. ${signal.kind} ${signal.sourcePath}`)
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question('Pick numbers or source paths, comma-separated: ')
    const tokens = answer.split(',').map((item) => item.trim()).filter(Boolean)
    if (!tokens.length) throw new Error('No signals selected')
    const picked = tokens.map((token) => {
      const index = Number(token)
      if (Number.isInteger(index) && index >= 1 && index <= signals.length) return signals[index - 1]
      const signal = signals.find((candidate) => candidate.sourcePath === token)
      if (!signal) throw new Error(`Unknown signal pick: ${token}`)
      return signal
    })
    return [...new Map(picked.map((signal) => [signal.sourcePath, signal])).values()]
  } finally {
    rl.close()
  }
}

function parseEnrichAiMode(value: unknown) {
  if (value == null || value === false) return false
  if (value === true || value === '') return 'local'
  const mode = String(value).trim().toLowerCase()
  if (mode === 'local') return 'local'
  throw new Error(`Unsupported --enrich-ai mode: ${String(value)}. Only --enrich-ai=local is supported.`)
}

async function getTopLevelPaths(tree: { listEntries(): Promise<Array<{ path: string }>> }) {
  const entries = await tree.listEntries()
  return [...new Set(entries.map((entry) => entry.path.split('/')[0]).filter(Boolean))].sort()
}

async function writeMaterializedFiles(outDir: string, files: Awaited<ReturnType<typeof materializePlugin>>) {
  for (const file of files) {
    const destination = path.resolve(outDir, file.path)
    if (destination !== outDir && !destination.startsWith(`${outDir}${path.sep}`)) {
      throw new Error(`Materialized file escapes output directory: ${file.path}`)
    }
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, file.bytes)
  }
}

function titleFromPluginId(pluginId: string) {
  return (pluginId.split('.').at(-1) ?? pluginId)
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function deriveInstallPluginId(sourceLabel: string) {
  return `external.${slugFromSource(sourceLabel)}`
}

function buildExternalRepoIdentity(input: {
  pluginId: string
  version: string
  sourceLabel: string
  ref?: string
  commitSha?: string
  subdir?: string
  scanDigest: string
  pickedSignalPaths: string[]
}): PluginInstallSpecIdentity {
  const repo = parseGitHubSource(input.sourceLabel)
  return {
    kind: 'external-repo',
    repoUrl: repo?.repoUrl ?? (path.isAbsolute(input.sourceLabel) ? pathToFileURL(input.sourceLabel).href : input.sourceLabel),
    owner: repo?.owner,
    repo: repo?.repo,
    ref: input.ref,
    commitSha: input.commitSha,
    subdir: input.subdir,
    scanDigest: input.scanDigest,
    pickedSignalPaths: [...new Set(input.pickedSignalPaths)].sort(),
    pluginId: input.pluginId,
    version: input.version,
  }
}

function sourceReferenceForManifest(source: RepoScanSource) {
  const repo = parseGitHubSource(source.label)
  if (repo) {
    return {
      repoUrl: repo.repoUrl,
      owner: repo.owner,
      repo: repo.repo,
    }
  }
  if (source.type === 'local' && path.isAbsolute(source.label)) {
    return { repoUrl: pathToFileURL(source.label).href }
  }
  return { repoUrl: source.label }
}

function resolveExternalCacheRoot(sourceLabel: string, scanDigest: string, revision?: string) {
  const repo = parseGitHubSource(sourceLabel)
  const owner = sanitizePathSegment(repo?.owner ?? 'local')
  const name = sanitizePathSegment(repo?.repo ?? slugFromSource(sourceLabel))
  const rev = sanitizePathSegment(revision ?? scanDigest)
  return path.join(getAgentRigHome(), '.agentrig', 'cache', 'external', owner, name, rev)
}

function parseGitHubSource(sourceLabel: string) {
  const shorthand = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(sourceLabel)
  if (shorthand) {
    const repoName = stripGitSuffix(shorthand[2])
    return {
      owner: shorthand[1],
      repo: repoName,
      repoUrl: `https://github.com/${shorthand[1]}/${repoName}`,
    }
  }
  const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(?:\/.*)?$/.exec(sourceLabel)
  if (!url) return undefined
  const repoName = stripGitSuffix(url[2])
  return {
    owner: url[1],
    repo: repoName,
    repoUrl: `https://github.com/${url[1]}/${repoName}`,
  }
}

function slugFromSource(sourceLabel: string) {
  const repo = parseGitHubSource(sourceLabel)
  const sourceName = repo?.repo ?? path.basename(sourceLabel)
  return sanitizePathSegment(sourceName).replace(/^-+|-+$/g, '') || 'repo'
}

function sanitizePathSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown'
}

async function pathExists(target: string) {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

function stripGitSuffix(repoName: string) {
  return repoName.endsWith('.git') ? repoName.slice(0, -4) : repoName
}

function digestMaterializedFiles(files: Awaited<ReturnType<typeof materializePlugin>>) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.bytes)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export default command
