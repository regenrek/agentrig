import { normalizeVirtualPath, type VirtualTreeFile } from '../virtual-tree'
import type { PluginManifest } from '../../agent-plugins'
import { inspectAgentPluginPackage, type AgentPluginDiagnostic } from '../../agent-plugin-package'
import type { DetectorInput, PluginCandidate, PluginProviderId } from './common'

const PLUGIN_MANIFEST_DIRS: Record<string, PluginProviderId> = {
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
    diagnostics: manifest.diagnostics,
    conformance: manifest.conformance,
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
  const provider = manifestDir ? PLUGIN_MANIFEST_DIRS[manifestDir] : undefined
  if (!provider && parts.slice(0, -1).some((part) => part.startsWith('.'))) return undefined
  const isPortableManifest = !provider

  const candidate = {
    provider: provider ?? 'agentrig' as const,
    manifestPath: path,
    rootPath: parts.slice(0, isPortableManifest ? -1 : -2).join('/'),
  }
  const manifest = isPortableManifest
    ? await parseAgentrigPluginManifestCandidate(input, path, candidate.rootPath)
    : undefined
  if (isPortableManifest && !manifest) return undefined
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
  diagnostics: AgentPluginDiagnostic[]
  conformance: {
    loadable: boolean
    portable: boolean
    publishable: boolean
  }
  manifestFile: {
    path: string
    digest: string
    bytes: number
    content: string
  }
}

async function parseAgentrigPluginManifestCandidate(
  input: Pick<DetectorInput, 'files' | 'tree'>,
  path: string,
  rootPath: string,
): Promise<ParsedAgentrigPluginManifestCandidate | undefined> {
  const manifestFile = input.files.find((file) => normalizeVirtualPath(file.path) === path)
  if (!manifestFile) return undefined
  return parseAgentrigPluginManifestText(input, path, rootPath, manifestFile)
}

async function parseAgentrigPluginManifestText(
  input: Pick<DetectorInput, 'files' | 'tree'>,
  path: string,
  rootPath: string,
  file: VirtualTreeFile
): Promise<ParsedAgentrigPluginManifestCandidate | undefined> {
  const text = await input.tree.readText(path)
  if (!text) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const prefix = rootPath ? `${normalizeVirtualPath(rootPath)}/` : ''
  const skills = await Promise.all(input.files.flatMap((candidate) => {
    const candidatePath = normalizeVirtualPath(candidate.path)
    const relativePath = prefix && candidatePath.startsWith(prefix)
      ? candidatePath.slice(prefix.length)
      : prefix ? '' : candidatePath
    if (!/^skills\/[^/]+\/SKILL\.md$/.test(relativePath)) return []
    return [input.tree.readText(candidatePath).then((content) => content === null ? undefined : ({ path: relativePath, content }))]
  }))
  const mcpPath = prefix ? `${prefix}mcp.json` : 'mcp.json'
  const hasMcp = input.files.some((candidate) => normalizeVirtualPath(candidate.path) === mcpPath)
  const mcpContent = hasMcp ? await input.tree.readText(mcpPath) : null
  const result = inspectAgentPluginPackage({
    manifest: parsed,
    skills: skills.filter((skill): skill is NonNullable<typeof skill> => Boolean(skill)),
    ...(mcpContent === null ? {} : { mcp: { path: 'mcp.json', content: mcpContent } }),
  })
  if (!result.package) return undefined
  return {
    manifest: result.package.manifest,
    diagnostics: result.diagnostics,
    conformance: result.conformance,
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
