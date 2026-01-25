import path from 'node:path'
import { readJsonFile } from './fs'
import {
  parseRegistryAndItemFromString,
  buildRegistryUrl,
  expandEnvVars,
  isValidPackName,
} from './namespace'
import type {
  PackMeta,
  RegistryIndex,
  RegistryRef,
  NamespacedRegistryConfig,
  DirectoryEntry,
  TrustTier,
} from './types'

/** Default official registry URL */
export const OFFICIAL_REGISTRY_URL = 'https://agentrig.ai/registry'

/** Default directory index URL */
export const DIRECTORY_INDEX_URL = 'https://agentrig.ai/directory/index.json'

export type SourceBase =
  | { type: 'url'; baseUrl: string }
  | { type: 'fs'; baseDir: string }

export type ResolvedPack = {
  meta: PackMeta
  source: SourceBase
  sourceLabel: string
  trustTier?: TrustTier
}

export function isUrl(spec: string) {
  return /^https?:\/\//i.test(spec)
}

export function isFileish(spec: string) {
  return spec.endsWith('.json') || spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || spec.includes('\\')
}

export function joinUrl(baseUrl: string, rel: string) {
  // Normalize base so URL(rel, base) behaves like path-joining.
  // This also catches protocol-relative URLs like "//evil.com/x" as absolute URLs.
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const resolved = new URL(rel, base)
  if (resolved.origin !== base.origin) {
    throw new Error(`External URLs are not allowed for pack files: ${rel}`)
  }
  return resolved.toString()
}

const DEFAULT_FETCH_TIMEOUT_MS = 15000
const MAX_RETRIES = 1
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  let attempt = 0
  while (attempt <= MAX_RETRIES) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { accept: 'application/json', ...headers },
      })
      if (res.ok) {
        return (await res.json()) as T
      }
      if (!RETRY_STATUSES.has(res.status)) {
        throw new NonRetryableError(`Request failed (${res.status}) for ${url}`)
      }
      if (attempt === MAX_RETRIES) {
        throw new Error(`Request failed (${res.status}) for ${url}`)
      }
    } catch (error) {
      if (error instanceof NonRetryableError) throw error
      if (attempt === MAX_RETRIES) throw error
    }
    attempt += 1
    const delayMs = 250 * 2 ** attempt
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(`Request failed after retries for ${url}`)
}

/**
 * Fetch the directory index from agentrig.ai or a custom URL.
 */
export async function fetchDirectoryIndex(
  url: string = DIRECTORY_INDEX_URL
): Promise<DirectoryEntry[]> {
  return fetchJson<DirectoryEntry[]>(url)
}

/**
 * Find a registry entry in the directory by namespace.
 */
export async function findRegistryInDirectory(
  namespace: string,
  directoryUrl: string = DIRECTORY_INDEX_URL
): Promise<DirectoryEntry | null> {
  const entries = await fetchDirectoryIndex(directoryUrl)
  return entries.find((e) => e.name === namespace) ?? null
}

/**
 * Build URL and headers for a namespaced registry item.
 */
export function buildUrlAndHeadersForNamespacedItem(
  packName: string,
  registryConfig: NamespacedRegistryConfig
): { url: string; headers: Record<string, string> } {
  if (typeof registryConfig === 'string') {
    return {
      url: buildRegistryUrl(registryConfig, packName),
      headers: {},
    }
  }

  const url = buildRegistryUrl(registryConfig.url, packName)
  const headers: Record<string, string> = {}

  if (registryConfig.headers) {
    for (const [key, value] of Object.entries(registryConfig.headers)) {
      headers[key] = expandEnvVars(value)
    }
  }

  // Add query params if specified
  if (registryConfig.params) {
    const urlObj = new URL(url)
    for (const [key, value] of Object.entries(registryConfig.params)) {
      urlObj.searchParams.set(key, expandEnvVars(value))
    }
    return { url: urlObj.toString(), headers }
  }

  return { url, headers }
}

/**
 * Resolve a pack from namespaced registries configuration.
 */
export async function resolvePackFromNamespacedRegistry(
  spec: string,
  namespacedRegistries: Record<string, NamespacedRegistryConfig>
): Promise<ResolvedPack> {
  const { registry, item } = parseRegistryAndItemFromString(spec)

  if (!registry) {
    throw new Error(`Invalid namespaced pack spec: ${spec}`)
  }

  if (!isValidPackName(item)) {
    throw new Error(`Invalid pack name in namespaced spec: ${spec}`)
  }

  const registryConfig = namespacedRegistries[registry]
  if (!registryConfig) {
    throw new Error(
      `Registry "${registry}" is not configured. Add it to your config:\n` +
        `{\n  "namespacedRegistries": {\n    "${registry}": "https://example.com/{name}.json"\n  }\n}`
    )
  }

  const { url, headers } = buildUrlAndHeadersForNamespacedItem(item, registryConfig)
  const meta = await fetchJson<PackMeta>(url, headers)

  // Determine base URL for file fetching
  const baseUrl = url.replace(/\/[^/]*\.json$/, '/')

  return {
    meta,
    source: { type: 'url', baseUrl },
    sourceLabel: `${registry}/${item}`,
  }
}

export async function readRegistryIndex(registryUrl: string): Promise<RegistryIndex> {
  const u = joinUrl(registryUrl, 'registry.json')
  return fetchJson<RegistryIndex>(u)
}

export async function resolvePackByName(name: string, registries: RegistryRef[], preferredRegistry?: string): Promise<ResolvedPack> {
  const candidates: RegistryRef[] = []

  if (preferredRegistry) {
    const byName = registries.find((r) => r.name === preferredRegistry)
    if (byName) candidates.push(byName)
    else if (isUrl(preferredRegistry)) candidates.push({ name: preferredRegistry, url: preferredRegistry })
    else candidates.push({ name: preferredRegistry, url: preferredRegistry })
  }

  for (const r of registries) {
    if (!candidates.find((c) => c.url === r.url)) candidates.push(r)
  }

  const errors: string[] = []
  for (const r of candidates) {
    try {
      const metaUrl = joinUrl(r.url, `${name}.json`)
      const meta = await fetchJson<PackMeta>(metaUrl)
      const trustTier: TrustTier | undefined = r.url.startsWith(OFFICIAL_REGISTRY_URL) ? 'official' : undefined
      return {
        meta,
        source: { type: 'url', baseUrl: r.url },
        sourceLabel: `registry:${r.name}`,
        trustTier,
      }
    } catch (e) {
      errors.push(String(e))
    }
  }
  throw new Error(`Unable to resolve pack "${name}" from registries.\n${errors.join('\n')}`)
}

export async function resolvePackFromMetaSpec(spec: string, cwd: string): Promise<ResolvedPack> {
  if (isUrl(spec)) {
    const metaUrl = spec
    const meta = await fetchJson<PackMeta>(metaUrl)
    // Base is the meta URL directory, so relative file paths work naturally.
    const baseUrl = metaUrl.replace(/\/[^/]*$/, '/')
    return { meta, source: { type: 'url', baseUrl }, sourceLabel: `url:${metaUrl}` }
  }

  // local file
  const abs = path.isAbsolute(spec) ? spec : path.join(cwd, spec)
  const meta = await readJsonFile<PackMeta>(abs)
  if (!meta) throw new Error(`Meta file not found: ${abs}`)
  return { meta, source: { type: 'fs', baseDir: path.dirname(abs) }, sourceLabel: `file:${abs}` }
}

export async function readSourceFile(source: SourceBase, relPath: string): Promise<Uint8Array> {
  if (source.type === 'url') {
    const url = joinUrl(source.baseUrl, relPath)
    const res = await fetchWithTimeout(url, {})
    if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  // fs
  const p = path.isAbsolute(relPath) ? relPath : path.join(source.baseDir, relPath)
  const data = await import('node:fs/promises').then((m) => m.readFile(p))
  return new Uint8Array(data)
}
