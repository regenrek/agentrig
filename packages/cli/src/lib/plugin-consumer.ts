import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  verifyInstallBundleHashes,
  type FetchedInstallFile,
  type InstallBundle,
  type RegistryRef,
  type VerifyIssue,
} from '@agentrig/sdk'
import { ensureDir } from './fs'
import { resolvePluginSpec } from './plugin-resolver'
import {
  fetchInstallBundleFiles as defaultFetchInstallBundleFiles,
} from './registry'
import { validatePluginPaths } from './trust'

function resolvePluginSourcePath(pluginDir: string, relativePath: string) {
  const normalized = path.normalize(relativePath)
  if (path.isAbsolute(normalized)) {
    throw new Error(`Absolute plugin source paths are not allowed: ${relativePath}`)
  }

  const destinationPath = path.resolve(pluginDir, normalized)
  const relativeToPluginDir = path.relative(pluginDir, destinationPath)
  if (relativeToPluginDir.startsWith('..') || path.isAbsolute(relativeToPluginDir)) {
    throw new Error(`Plugin source path escapes the plugin root: ${relativePath}`)
  }

  return destinationPath
}

export type ResolvedPluginGraph = {
  requestedPlugin: InstallBundle
  resolvedPlugins: InstallBundle[]
}

type FetchedInstallFileWithBytes = Extract<FetchedInstallFile, { bytes: unknown }>
type InstallBundleFileFetcher = (bundle: InstallBundle) => Promise<readonly FetchedInstallFile[]>
type MaterializeOptions = {
  fetchInstallBundleFiles?: InstallBundleFileFetcher
}

export async function resolvePluginGraph(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
): Promise<ResolvedPluginGraph> {
  const requestedPlugin = await resolvePluginSpec(spec, cwd, registries)
  return {
    requestedPlugin,
    resolvedPlugins: [requestedPlugin],
  }
}

export async function verifyFetchedInstallBundleFiles(
  bundle: InstallBundle,
  fetchedFiles: readonly FetchedInstallFile[]
) {
  const result = await verifyInstallBundleHashes(bundle, fetchedFiles)
  if (result.ok) return result

  throw new Error(
    `Install bundle hash verification failed for ${bundle.listing.artifactId}@${bundle.listing.version}:\n` +
      result.issues.map((issue) => formatVerifyIssue(issue, fetchedFiles)).join('\n')
  )
}

export async function materializeResolvedPluginGraph(
  graph: ResolvedPluginGraph,
  options: MaterializeOptions = {}
) {
  const pluginsRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-source-'))
  const fetchInstallBundleFiles = options.fetchInstallBundleFiles ?? defaultFetchInstallBundleFiles

  for (const bundle of graph.resolvedPlugins) {
    const installFiles = bundle.file_list
    if (installFiles.length === 0) {
      throw new Error(
        `Plugin "${bundle.listing.artifactId}" is missing required install bundle files.`
      )
    }
    const pathValidation = validatePluginPaths(installFiles)
    if (!pathValidation.valid) {
      throw new Error(
        `Plugin "${bundle.listing.artifactId}" contains invalid file paths:\n` +
          pathValidation.disallowed.map((target) => `  - ${target}`).join('\n')
      )
    }

    const fetchedFiles = await fetchInstallBundleFiles(bundle)
    await verifyFetchedInstallBundleFiles(bundle, fetchedFiles)

    const filesByPath = new Map(
      fetchedFiles
        .filter(hasFetchedBytes)
        .map((file) => [file.path, bytesFromFetchedFile(file.bytes)])
    )
    const pluginDir = path.join(pluginsRoot, bundle.listing.artifactId)
    await ensureDir(pluginDir)

    for (const file of installFiles) {
      const bytes = filesByPath.get(file.path)
      if (!bytes) {
        throw new Error(`Install bundle file missing after verification: ${file.path}`)
      }
      const destinationPath = resolvePluginSourcePath(pluginDir, file.path)
      await ensureDir(path.dirname(destinationPath))
      await fs.writeFile(destinationPath, bytes)
    }
  }

  return {
    resolved: graph.requestedPlugin,
    resolvedPlugins: graph.resolvedPlugins,
    pluginsRoot,
    pluginDir: path.join(pluginsRoot, graph.requestedPlugin.listing.artifactId),
  }
}

export async function materializeResolvedStandaloneArtifact(resolved: InstallBundle) {
  const artifactsRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-artifact-source-'))
  const artifactDir = path.join(artifactsRoot, resolved.listing.artifactId)
  await ensureDir(artifactDir)

  const pathValidation = validatePluginPaths(resolved.file_list)
  if (!pathValidation.valid) {
    throw new Error(
      `Artifact "${resolved.listing.artifactId}" contains invalid file paths:\n` +
        pathValidation.disallowed.map((target) => `  - ${target}`).join('\n')
    )
  }
  const fetchedFiles = await defaultFetchInstallBundleFiles(resolved)
  await verifyFetchedInstallBundleFiles(resolved, fetchedFiles)
  const filesByPath = new Map(
    fetchedFiles
      .filter(hasFetchedBytes)
      .map((file) => [file.path, bytesFromFetchedFile(file.bytes)])
  )

  for (const file of resolved.file_list) {
    const bytes = filesByPath.get(file.path)
    if (!bytes) {
      throw new Error(`Install bundle file missing after verification: ${file.path}`)
    }
    const destinationPath = resolvePluginSourcePath(artifactDir, file.path)
    await ensureDir(path.dirname(destinationPath))
    await fs.writeFile(destinationPath, bytes)
  }

  return {
    artifactsRoot,
    artifactDir,
    sourceRoot: standaloneSourceRoot(resolved),
  }
}

export async function materializeResolvedPlugin(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
) {
  const graph = await resolvePluginGraph(spec, cwd, registries)
  return materializeResolvedPluginGraph(graph)
}

export async function cleanupMaterializedPlugin(pluginsRoot: string) {
  await fs.rm(pluginsRoot, { recursive: true, force: true })
}

function hasFetchedBytes(file: FetchedInstallFile): file is FetchedInstallFileWithBytes {
  return !file.missing
}

function bytesFromFetchedFile(value: FetchedInstallFileWithBytes['bytes']) {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}

function formatVerifyIssue(issue: VerifyIssue, fetchedFiles: readonly FetchedInstallFile[]) {
  if (issue.code === 'missing') {
    const failedFetch = fetchedFiles.find(
      (file): file is Extract<FetchedInstallFile, { missing: true }> =>
        file.path === issue.path && file.missing === true
    )
    const status = failedFetch?.status
    if (failedFetch && typeof status === 'number') {
      return formatFetchFailure(issue.path, status, failedFetch.url)
    }
  }
  const parts = [`  - ${issue.path}: ${issue.code}`]
  if (issue.expected != null) parts.push(`expected=${issue.expected}`)
  if (issue.actual != null) parts.push(`actual=${issue.actual}`)
  return parts.join(' ')
}

function formatFetchFailure(filePath: string, status: number, url: string | undefined) {
  const host = url ? safeHostname(url) : undefined
  if (status === 429 && host && isGithubHost(host)) {
    return `  - Failed to fetch ${filePath}: HTTP 429 (rate-limited by github.com). Retry in ~30s, or set GITHUB_TOKEN to increase rate limit.`
  }
  return `  - Failed to fetch ${filePath}: HTTP ${status}${host ? ` from ${host}` : ''}.`
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function isGithubHost(host: string) {
  return host === 'github.com' || host.endsWith('.github.com') || host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com')
}

function standaloneSourceRoot(bundle: InstallBundle) {
  const firstPath = bundle.file_list[0]?.path
  if (!firstPath) return bundle.listing.artifactId
  const segments = firstPath.split('/')
  if (segments.length > 2 && ['skills', 'mcps', 'hooks'].includes(segments[0]!)) {
    return segments.slice(0, 2).join('/')
  }
  return '.'
}
