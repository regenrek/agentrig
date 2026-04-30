import { normalizeVirtualPath, type VirtualTreeFile } from '../virtual-tree'
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
  manifest: { artifactId: string; version?: string }
) {
  if (candidate.provider !== 'agentrig') return undefined
  const files = filesForPluginRoot(input.files, candidate.rootPath)
  if (!files.length) return undefined
  return {
    artifactId: manifest.artifactId,
    ...(manifest.version ? { version: manifest.version } : {}),
    sourcePath: candidate.rootPath || '.',
    manifestPath: candidate.manifestPath,
    files: files.map((file) => ({
      path: normalizeVirtualPath(file.path),
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
  const manifest = provider === 'agentrig' ? parseAgentrigPluginManifestCandidate(await readJson(input, path)) : undefined
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

function parseAgentrigPluginManifestCandidate(raw: unknown) {
  if (!isRecord(raw)) return undefined
  const artifactId = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!artifactId) return undefined
  const version = typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : undefined
  return { artifactId, ...(version ? { version } : {}) }
}

function filesForPluginRoot(files: readonly VirtualTreeFile[], rootPath: string) {
  const root = rootPath ? normalizeVirtualPath(rootPath) : ''
  const prefix = root ? `${root}/` : ''
  return files
    .filter((file) => {
      const path = normalizeVirtualPath(file.path)
      return !root || path === root || path.startsWith(prefix)
    })
    .sort((left, right) => normalizeVirtualPath(left.path).localeCompare(normalizeVirtualPath(right.path)))
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
