import { createHash } from 'node:crypto'
import process from 'node:process'
import {
  InstallBundleSchema,
  ListingInstallResolutionSchema,
  type ArtifactKind,
  type FetchedInstallFile,
  type InstallBundle,
  type InstallBundleFile,
  type RegistryRef,
} from '@agentrig/sdk'
import type { PluginUploadPolicySnapshot } from './types'

export type InstallBundleResolveInput = {
  kind: ArtifactKind
  artifactId: string
  origin?: 'standalone' | 'bundled'
}

export const OFFICIAL_REGISTRY_ALIAS = 'agentrig'
export const OFFICIAL_REGISTRY_URL = normalizeRegistryUrl(
  process.env.AGENTRIG_OFFICIAL_REGISTRY_URL
    ?? process.env.AGENTRIG_BASE_URL
    ?? 'https://agentrig.ai'
)

export type SourceBase = { type: 'url'; baseUrl: string }
export type ResolvedPlugin = InstallBundle
export type ResolvedStandaloneArtifact = InstallBundle
export type StandaloneRegistryArtifactKind = Extract<ArtifactKind, 'skill' | 'mcp' | 'hook'>

export const LOCAL_PLUGIN_POLICY: PluginUploadPolicySnapshot = {
  maxZipBytes: 10 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFiles: 100,
  allowedContentTypes: ['application/zip'],
  blockedExtensions: ['.exe', '.dll', '.dylib', '.so', '.bin', '.app', '.pkg', '.dmg', '.iso', '.jar'],
  allowedFileExtensions: [
    '.md',
    '.txt',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.mjs',
    '.cjs',
    '.sh',
    '.bash',
    '.zsh',
    '.py',
    '.rb',
    '.php',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.swift',
    '.css',
    '.scss',
    '.html',
    '.mdx',
    '.sql',
  ],
  allowedFilenames: [
    'README',
    'README.md',
    'LICENSE',
    'NOTICE',
    'CODEOWNERS',
    'Makefile',
    'Dockerfile',
    '.env',
    '.gitignore',
    '.dockerfile',
    '.Dockerfile',
  ],
  allowedTargetPrefixes: [
    'skills/',
    'agents/',
    'hooks/',
    '.codex/',
    '.claude/',
    '.cursor/',
    '.agentrig/',
    'scripts/',
    'tools/',
  ],
  publishedVersionRetention: 0,
}

const DEFAULT_FETCH_TIMEOUT_MS = 15000
const MAX_RETRIES = 1
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export function normalizeRegistryUrl(url: string) {
  return url.replace(/\/+$/, '')
}

export function resolveConfiguredRegistry(alias: string, registries: RegistryRef[]): RegistryRef {
  if (alias === OFFICIAL_REGISTRY_ALIAS) {
    const configured = registries.find((entry) => entry.name === alias)
    return configured
      ? { name: configured.name, url: normalizeRegistryUrl(configured.url) }
      : { name: OFFICIAL_REGISTRY_ALIAS, url: OFFICIAL_REGISTRY_URL }
  }
  const registry = registries.find((entry) => entry.name === alias)
  if (!registry) {
    throw new Error(
      `Unknown marketplace alias "${alias}". Add it first with:\n` +
        `agentrig registry add ${alias} <baseUrl>`
    )
  }
  return {
    name: registry.name,
    url: normalizeRegistryUrl(registry.url),
  }
}

export async function resolveInstallBundleFromConvex(
  registry: RegistryRef,
  input: InstallBundleResolveInput
): Promise<InstallBundle> {
  const url = new URL('/api/cli/install-bundle', marketplaceBaseUrl(registry.url))
  url.searchParams.set('kind', input.kind)
  url.searchParams.set('artifactId', input.artifactId)
  if (input.origin) url.searchParams.set('origin', input.origin)
  const raw = await fetchJson<unknown>(url.toString())
  const resolution = ListingInstallResolutionSchema.parse(raw)
  if (resolution.status === 'resolvable') {
    return InstallBundleSchema.parse(resolution.bundle)
  }

  const detail = resolution.message ? ` ${resolution.message}` : ''
  const label = `${input.kind}:${input.artifactId}`
  if (resolution.reason === 'yanked') {
    throw new Error(`Marketplace listing "${label}" has been yanked and cannot be installed.${detail}`)
  }
  if (resolution.reason === 'taken_down') {
    throw new Error(`Marketplace listing "${label}" has been taken down and cannot be installed.${detail}`)
  }
  throw new Error(`Marketplace listing "${label}" cannot be installed: ${resolution.reason}.${detail}`)
}

export async function resolveInstallBundleFromRegistryAlias(
  alias: string,
  input: InstallBundleResolveInput,
  version: string | undefined,
  registries: RegistryRef[]
): Promise<InstallBundle> {
  const registry = resolveConfiguredRegistry(alias, registries)
  const bundle = await resolveInstallBundleFromConvex(registry, input)
  if (version && bundle.listing.version !== version) {
    throw new Error(
      `Marketplace listing "${input.kind}:${input.artifactId}" resolved to version ${bundle.listing.version}, not requested ${version}.`
    )
  }
  return bundle
}

export async function resolvePluginFromRegistryAlias(
  alias: string,
  artifactId: string,
  version: string | undefined,
  registries: RegistryRef[]
): Promise<ResolvedPlugin> {
  const bundle = await resolveInstallBundleFromRegistryAlias(
    alias,
    { kind: 'plugin', artifactId },
    version,
    registries
  )
  if (bundle.listing.kind !== 'plugin') {
    throw new Error(`Marketplace listing "${artifactId}" is a ${bundle.listing.kind}, not a plugin.`)
  }
  return bundle
}

export async function resolveStandaloneArtifact(
  alias: string,
  artifactKind: StandaloneRegistryArtifactKind,
  artifactId: string,
  version: string | undefined,
  registries: RegistryRef[]
): Promise<ResolvedStandaloneArtifact> {
  const bundle = await resolveInstallBundleFromRegistryAlias(
    alias,
    { kind: artifactKind, artifactId, origin: 'standalone' },
    version,
    registries
  )
  if (bundle.listing.kind !== artifactKind) {
    throw new Error(`Marketplace listing "${artifactId}" is a ${bundle.listing.kind}, not a ${artifactKind}.`)
  }
  return bundle
}

export function registryArtifactSourcePath(kind: StandaloneRegistryArtifactKind, artifactId: string) {
  const artifactName = artifactId.split('.').at(-1) ?? artifactId
  const root = kind === 'skill' ? 'skills' : kind === 'mcp' ? 'mcps' : 'hooks'
  return `${root}/${artifactName}`
}

export async function readInstallBundleFile(
  bundle: InstallBundle,
  file: InstallBundleFile
): Promise<Uint8Array> {
  const url = installBundleFileUrl(bundle, file)
  const res = await fetchWithTimeout(url, {})
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function readSourceFile(source: SourceBase, relPath: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout(joinUrl(source.baseUrl, relPath), {})
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${source.baseUrl}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function fetchInstallBundleFiles(bundle: InstallBundle): Promise<FetchedInstallFile[]> {
  return Promise.all(
    bundle.file_list.map(async (file) => {
      if (file.inline) {
        try {
          return { path: file.path, bytes: decodeBase64(file.inline) }
        } catch (error) {
          return {
            path: file.path,
            missing: true,
            error: `Invalid inline payload: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }
      try {
        return {
          path: file.path,
          bytes: await readInstallBundleFile(bundle, file),
        }
      } catch (error) {
        return {
          path: file.path,
          missing: true,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  )
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

export function installBundleSourceLabel(bundle: InstallBundle) {
  const alias = bundle.listing.registryAlias ?? OFFICIAL_REGISTRY_ALIAS
  return `${alias}/${bundle.listing.slug ?? bundle.listing.artifactId}@${bundle.listing.version}`
}

export function installBundleSnapshotDigest(bundle: InstallBundle) {
  return bundle.listing.registrySnapshotDigest ?? digestBundleFileList(bundle)
}

export function joinUrl(baseUrl: string, rel: string) {
  const base = new URL(baseUrl)
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`
  }
  const resolved = new URL(rel, base)
  if (resolved.origin !== base.origin) {
    throw new Error(`External URLs are not allowed for install bundle files: ${rel}`)
  }
  if (!resolved.search && base.search && !/[?#]/.test(rel)) {
    resolved.search = base.search
  }
  return resolved.toString()
}

function marketplaceBaseUrl(configuredUrl: string) {
  return normalizeRegistryUrl(configuredUrl)
}

function installBundleFileUrl(bundle: InstallBundle, file: InstallBundleFile) {
  if (file.url) return file.url
  const relPath = file.sourcePath ?? file.path
  if (bundle.source.type === 'github') {
    return githubRawUrl(bundle, relPath)
  }
  if (bundle.source.url) {
    return joinUrl(bundle.source.url, relPath)
  }
  throw new Error(`Install bundle source cannot provide bytes for ${file.path}.`)
}

function githubRawUrl(bundle: InstallBundle, relPath: string) {
  const sourceUrl = bundle.source.url
  const ref = bundle.source.commitSha ?? bundle.source.ref
  if (!sourceUrl || !ref) {
    throw new Error(`GitHub install bundle source is missing url or ref for ${bundle.listing.artifactId}.`)
  }
  const parsed = new URL(sourceUrl)
  const [owner, repoRaw] = parsed.pathname.replace(/^\/+/, '').split('/')
  const repo = repoRaw?.replace(/\.git$/, '')
  if (parsed.hostname !== 'github.com' || !owner || !repo) {
    throw new Error(`Unsupported GitHub install bundle source URL: ${sourceUrl}`)
  }
  const sourcePath = [bundle.source.subdir, relPath]
    .filter((part): part is string => Boolean(part))
    .join('/')
    .replace(/^\/+/, '')
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${sourcePath}`
}

async function fetchJson<T>(url: string): Promise<T> {
  let attempt = 0
  while (attempt <= MAX_RETRIES) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: 'application/json' },
      })
      const body = await readJsonBody(res)
      if (res.ok) return body as T
      const parsed = ListingInstallResolutionSchema.safeParse(body)
      if (parsed.success && parsed.data.status === 'unresolvable') {
        return parsed.data as T
      }
      if (!RETRY_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
        throw new Error(`Request failed (${res.status}) for ${url}`)
      }
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
    }
    attempt += 1
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
  throw new Error(`Request failed after retries for ${url}`)
}

async function readJsonBody(res: Response) {
  const text = await res.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`Invalid JSON response (${res.status}) from ${res.url}`)
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function digestBundleFileList(bundle: InstallBundle) {
  const payload = JSON.stringify(
    bundle.file_list
      .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }))
      .sort((left, right) => left.path.localeCompare(right.path))
  )
  return `sha256:${nodeSha256Hex(new TextEncoder().encode(payload))}`
}

function nodeSha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}
