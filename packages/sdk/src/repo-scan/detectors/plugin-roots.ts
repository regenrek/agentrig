import { normalizeVirtualPath, type VirtualTreeFile } from '../virtual-tree'
import { PluginManifestSchema, type PluginManifest } from '../../marketplace-listing'
import type { DetectorInput, PluginCandidate, PluginProviderId } from './common'

const PLUGIN_MANIFEST_DIRS: Record<string, PluginProviderId> = {
  '.plugin': 'agentrig',
  '.claude-plugin': 'claude',
  '.codex-plugin': 'codex',
  '.cursor-plugin': 'cursor',
}

export async function discoverPluginCandidates(input: Pick<DetectorInput, 'files' | 'tree'>): Promise<PluginCandidate[]> {
  const candidates: PluginCandidate[] = []

  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    const manifestCandidate = await candidateFromPluginManifest(input, path)
    if (manifestCandidate) {
      candidates.push(manifestCandidate)
      continue
    }

    const marketplaceCandidate = marketplaceFromPath(path)
    if (!marketplaceCandidate) continue

    const marketplace = await readJson(input, path)
    for (const sourcePath of marketplaceSources(marketplace, marketplaceCandidate.rootPath)) {
      candidates.push({
        provider: marketplaceCandidate.provider,
        manifestPath: path,
        rootPath: sourcePath,
        sourcePath,
      })
    }
  }

  return deduplicateCandidates(candidates)
}

export function rootsFromPluginCandidates(candidates: readonly PluginCandidate[]) {
  return ['', ...new Set(candidates.map((candidate) => candidate.rootPath).filter(Boolean))].sort()
}

export function scanPluginCandidatesFromDetected(candidates: readonly PluginCandidate[]) {
  return candidates
    .flatMap((candidate) => candidate.scanCandidate ? [candidate.scanCandidate] : [])
    .sort((left, right) => `${left.sourcePath}:${left.manifestPath}`.localeCompare(`${right.sourcePath}:${right.manifestPath}`))
}

function scanPluginCandidateFromManifest(
  input: Pick<DetectorInput, 'files'>,
  candidate: Pick<PluginCandidate, 'provider' | 'manifestPath' | 'rootPath'>,
  manifest: ParsedAgentrigPluginManifestCandidate
) {
  if (candidate.provider !== 'agentrig') return undefined
  const files = filesForPluginRoot(input.files, candidate.rootPath)
  if (!files.length) return undefined
  return {
    artifactId: manifest.manifest.name,
    ...(manifest.manifest.version ? { version: manifest.manifest.version } : {}),
    sourcePath: candidate.rootPath || '.',
    manifestPath: candidate.manifestPath,
    manifest: manifest.manifest,
    manifestFile: manifest.manifestFile,
    files: files.map(({ file, relativePath }) => ({
      path: relativePath,
      digest: file.sha256,
      bytes: file.bytes,
    })),
  }
}

async function candidateFromPluginManifest(input: Pick<DetectorInput, 'files' | 'tree'>, path: string): Promise<PluginCandidate | undefined> {
  const parts = path.split('/')
  if (parts.at(-1) !== 'plugin.json') return undefined

  const manifestDir = parts.at(-2)
  if (!manifestDir) return undefined

  const provider = PLUGIN_MANIFEST_DIRS[manifestDir]
  if (!provider) return undefined

  const candidate = {
    provider,
    manifestPath: path,
    rootPath: parts.slice(0, -2).join('/'),
  }
  const manifest = provider === 'agentrig' ? await parseAgentrigPluginManifestCandidate(input, path) : undefined
  const scanCandidate = manifest ? scanPluginCandidateFromManifest(input, candidate, manifest) : undefined
  return {
    ...candidate,
    ...(scanCandidate ? { scanCandidate } : {}),
  }
}

function marketplaceFromPath(path: string): { provider: PluginProviderId; rootPath: string } | undefined {
  const parts = path.split('/')
  if (parts.at(-1) !== 'marketplace.json') return undefined

  const manifestDir = parts.at(-2)
  if (!manifestDir) return undefined

  const provider = PLUGIN_MANIFEST_DIRS[manifestDir]
  if (!provider) return undefined

  return {
    provider,
    rootPath: parts.slice(0, -2).join('/'),
  }
}

async function readJson(input: Pick<DetectorInput, 'tree'>, path: string) {
  const text = await input.tree.readText(path)
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function marketplaceSources(raw: unknown, rootPath: string) {
  if (!isRecord(raw) || !Array.isArray(raw.plugins)) return []

  return raw.plugins.flatMap((plugin) => {
    if (!isRecord(plugin) || typeof plugin.source !== 'string') return []
    const normalized = normalizeMarketplaceSource(plugin.source, rootPath)
    return normalized ? [normalized] : []
  })
}

function normalizeMarketplaceSource(source: string, rootPath: string) {
  const cleaned = source.trim().replace(/^\.\/+/, '').replace(/\/+$/g, '')
  if (!cleaned || cleaned.startsWith('/') || cleaned.split('/').includes('..')) return undefined
  return rootPath ? normalizeVirtualPath(`${rootPath}/${cleaned}`) : normalizeVirtualPath(cleaned)
}

type ParsedAgentrigPluginManifestCandidate = {
  manifest: PluginManifest
  manifestFile: {
    path: string
    digest: string
    bytes: number
    content: string
  }
}

async function parseAgentrigPluginManifestCandidate(
  input: Pick<DetectorInput, 'files' | 'tree'>,
  path: string
): Promise<ParsedAgentrigPluginManifestCandidate | undefined> {
  const manifestFile = input.files.find((file) => normalizeVirtualPath(file.path) === path)
  if (!manifestFile) return undefined
  return parseAgentrigPluginManifestText(input.tree.readText(path), path, manifestFile)
}

async function parseAgentrigPluginManifestText(
  textPromise: Promise<string | null>,
  path: string,
  file: VirtualTreeFile
): Promise<ParsedAgentrigPluginManifestCandidate | undefined> {
  const text = await textPromise
  if (!text) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const result = PluginManifestSchema.safeParse(parsed)
  if (!result.success) return undefined
  return {
    manifest: result.data,
    manifestFile: {
      path,
      digest: file.sha256,
      bytes: file.bytes,
      content: text,
    },
  }
}

function filesForPluginRoot(files: readonly VirtualTreeFile[], rootPath: string) {
  const root = rootPath ? normalizeVirtualPath(rootPath) : ''
  const prefix = root ? `${root}/` : ''
  return files
    .flatMap((file) => {
      const path = normalizeVirtualPath(file.path)
      if (root && path !== root && !path.startsWith(prefix)) return []
      const relativePath = root ? path.slice(prefix.length) : path
      return relativePath ? [{ file, relativePath }] : []
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function deduplicateCandidates(candidates: readonly PluginCandidate[]) {
  const seen = new Set<string>()
  const unique: PluginCandidate[] = []

  for (const candidate of candidates) {
    const key = `${candidate.provider}:${candidate.manifestPath}:${candidate.rootPath}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }

  return unique.sort((left, right) =>
    `${left.rootPath}:${left.manifestPath}:${left.provider}`.localeCompare(`${right.rootPath}:${right.manifestPath}:${right.provider}`)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
