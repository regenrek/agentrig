import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs'
import {
  isAllowedExtension,
  isAllowedFilename,
  isBlockedExtension,
  isSafeRelativePath,
  validatePluginManifest,
} from './plugin-validation'
import type {
  PluginInstallMetadata,
  PluginManifest,
  RegistryIndex,
  RegistryRef,
  DirectoryEntry,
  PluginUploadPolicySnapshot,
  TrustTier,
} from './types'

/** Default official registry URL */
export const OFFICIAL_REGISTRY_URL =
  process.env.AGENTRIG_OFFICIAL_REGISTRY_URL ?? 'https://agentrig.ai/registry'

/** Default directory index URL */
export const DIRECTORY_INDEX_URL =
  process.env.AGENTRIG_DIRECTORY_INDEX_URL ?? 'https://agentrig.ai/directory/index.json'

export type SourceBase =
  | { type: 'url'; baseUrl: string }
  | { type: 'fs'; baseDir: string }

export type ResolvedPlugin = {
  manifest: PluginManifest
  installMetadata?: PluginInstallMetadata
  source: SourceBase
  sourceLabel: string
  trustTier?: TrustTier
  registry?: RegistryRef
}

type HistoryManifest = {
  id: string
  name: string
  latest: string
  versions: string[]
  description: string
  keywords?: string[]
  trustTier?: TrustTier
  paths: {
    plugin: string
    manifest: string
  }
}

function isValidInstallMetadataPath(filePath: string) {
  if (!filePath) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filePath)) return false
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) return false

  let decoded = filePath
  try {
    decoded = decodeURIComponent(filePath)
  } catch {
    return false
  }

  const normalized = decoded.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/')) return false
  if (normalized.includes('\0')) return false
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return false
  }

  return path.posix.normalize(normalized) === normalized
}

function validateInstallMetadata(
  raw: unknown,
  options: { label: string; requireNonEmpty: boolean; requireSha256?: boolean }
): PluginInstallMetadata {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid ${options.label}: not an object`)
  }
  const current = raw as Record<string, unknown>
  if (!Array.isArray(current.files)) {
    throw new Error(`Invalid ${options.label}: files must be an array`)
  }
  const files = current.files.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid ${options.label}: file entry must be an object`)
    }
    const file = entry as Record<string, unknown>
    const filePath = String(file.path ?? '').trim()
    if (!isValidInstallMetadataPath(filePath) || path.isAbsolute(filePath)) {
      throw new Error(`Invalid ${options.label}: bad file path "${filePath || '<empty>'}"`)
    }
    const mode = file.mode ? String(file.mode).trim() : undefined
    const sha256 = file.sha256 ? String(file.sha256).trim() : undefined
    if (mode && !/^[0-7]{3}$/.test(mode)) {
      throw new Error(`Invalid ${options.label}: bad file mode "${mode}"`)
    }
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`Invalid ${options.label}: bad sha256 for "${filePath}"`)
    }
    if (options.requireSha256 && !sha256) {
      throw new Error(`Invalid ${options.label}: sha256 is required for "${filePath}"`)
    }
    return { path: filePath, mode, sha256 }
  })
  if (options.requireNonEmpty && files.length === 0) {
    throw new Error(`Invalid ${options.label}: files must not be empty`)
  }
  return { files }
}

export function isUrl(spec: string) {
  return /^https?:\/\//i.test(spec)
}

export function isFileish(spec: string) {
  return spec.endsWith('.json') || spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || spec.includes('\\')
}

function isCanonicalPluginManifestUrl(url: string) {
  try {
    const parsed = new URL(url)
    const normalized = parsed.pathname.replace(/\\/g, '/')
    // Reject encoded traversal and unnormalized dot-segments before the suffix check
    if (/%2e|%2f/i.test(normalized)) return false
    const segments = normalized.split('/')
    if (segments.some((s) => s === '.' || s === '..')) return false
    return normalized.endsWith('/.plugin/plugin.json')
  } catch {
    return false
  }
}

function isCanonicalPluginManifestPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (segments.some((s) => s === '.' || s === '..')) return false
  return normalized.endsWith('/.plugin/plugin.json')
}

export function joinUrl(baseUrl: string, rel: string) {
  // Normalize base so URL(rel, base) behaves like path-joining.
  // This also catches protocol-relative URLs like "//evil.com/x" as absolute URLs.
  const base = new URL(baseUrl)
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`
  }
  const resolved = new URL(rel, base)
  if (resolved.origin !== base.origin) {
    throw new Error(`External URLs are not allowed for plugin files: ${rel}`)
  }
  if (!resolved.search && base.search && !/[?#]/.test(rel)) {
    resolved.search = base.search
  }
  return resolved.toString()
}

function deriveUrlPluginRoot(manifestUrl: string) {
  const parsed = new URL(manifestUrl)
  const search = parsed.search
  const suffix = '/.plugin/plugin.json'
  if (!parsed.pathname.endsWith(suffix)) {
    throw new Error(`Remote plugin manifests must point to /.plugin/plugin.json. Received: ${manifestUrl}`)
  }
  parsed.pathname = `${parsed.pathname.slice(0, -suffix.length)}/`
  parsed.hash = ''
  parsed.search = search
  const installMetadataUrl = new URL('.plugin/install.json', parsed)
  installMetadataUrl.search = search
  return {
    baseUrl: parsed.toString(),
    installMetadataUrl: installMetadataUrl.toString(),
  }
}

export function normalizeRegistryUrl(url: string) {
  return url.replace(/\/+$/, '')
}

export function isOfficialRegistry(registry: RegistryRef) {
  return normalizeRegistryUrl(registry.url) === normalizeRegistryUrl(OFFICIAL_REGISTRY_URL)
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

export async function readRegistryIndex(registryUrl: string): Promise<RegistryIndex> {
  const u = joinUrl(registryUrl, 'registry.json')
  return fetchJson<RegistryIndex>(u)
}

function getRegistryByName(name: string, registries: RegistryRef[]) {
  return registries.find((registry) => registry.name === name)
}

function getPrimaryRegistry(registries: RegistryRef[]) {
  return registries.find((registry) => registry.name === 'official')
}

export async function resolvePluginFromRegistryRef(
  registry: RegistryRef,
  pluginId: string
): Promise<ResolvedPlugin> {
  const index = await readRegistryIndex(registry.url)
  const entry = index.items.find((item) => item.id === pluginId)
  if (!entry) {
    throw new Error(`Plugin "${pluginId}" was not found in registry "${registry.name}".`)
  }

  const expectedManifestPath = `manifests/${pluginId}.json`
  if (entry.manifest !== expectedManifestPath) {
    throw new Error(
      `Registry index entry for "${pluginId}" must point to "${expectedManifestPath}", got "${entry.manifest}".`
    )
  }
  const historyManifest = await fetchJson<HistoryManifest>(
    joinUrl(registry.url, entry.manifest)
  )
  if (historyManifest.id !== pluginId) {
    throw new Error(`Registry manifest id mismatch for "${pluginId}".`)
  }
  if (historyManifest.paths?.manifest !== entry.manifest) {
    throw new Error(`Registry manifest path mismatch for "${pluginId}".`)
  }
  const pluginRootPath = String(historyManifest.paths?.plugin ?? '')
  const expectedPluginRootPath = `plugins/${pluginId}/${historyManifest.latest}`
  if (pluginRootPath !== expectedPluginRootPath) {
    throw new Error(
      `Registry manifest for "${pluginId}" paths.plugin must be exactly "${expectedPluginRootPath}", got "${pluginRootPath}".`
    )
  }

  const pluginManifestUrl = joinUrl(registry.url, `${pluginRootPath}/.plugin/plugin.json`)
  const rawManifest = await fetchJson<unknown>(pluginManifestUrl)
  const manifest = validatePluginManifest(rawManifest)
  if (manifest.id !== pluginId) {
    throw new Error(`Registry plugin manifest id mismatch for "${pluginId}".`)
  }
  if (manifest.version !== historyManifest.latest) {
    throw new Error(`Registry plugin manifest version mismatch for "${pluginId}".`)
  }
  const installMetadata = validateInstallMetadata(
    await fetchJson<PluginInstallMetadata>(
      joinUrl(registry.url, `${pluginRootPath}/.plugin/install.json`)
    ),
    {
      label: `.plugin/install.json for registry plugin "${pluginId}"`,
      requireNonEmpty: true,
      requireSha256: true,
    }
  )
  // Trust tier is always derived from registry config — never from manifest metadata.
  // A non-official registry cannot self-upgrade to 'official' via historyManifest.trustTier.
  const trustTier = isOfficialRegistry(registry) ? 'official' : 'listed'
  return {
    manifest,
    installMetadata,
    source: { type: 'url', baseUrl: joinUrl(registry.url, `${pluginRootPath}/`) },
    sourceLabel: `registry:${registry.name}`,
    trustTier,
    registry,
  }
}

export async function resolvePluginById(
  id: string,
  registries: RegistryRef[]
): Promise<ResolvedPlugin> {
  const primaryRegistry = getPrimaryRegistry(registries)
  if (!primaryRegistry) {
    throw new Error(
      'No primary registry is configured. Run `agentrig init` to create a fresh config.'
    )
  }

  return resolvePluginFromRegistryRef(primaryRegistry, id)
}

export async function resolvePluginFromRegistryAlias(
  alias: string,
  pluginId: string,
  registries: RegistryRef[]
): Promise<ResolvedPlugin> {
  const registry = getRegistryByName(alias, registries)
  if (!registry) {
    throw new Error(
      `Registry "${alias}" is not configured. Add it first with:\n` +
        `agentrig registry add ${alias} <baseUrl>`
    )
  }

  return resolvePluginFromRegistryRef(registry, pluginId)
}

const LOCAL_PLUGIN_EXCLUDE = new Set(['node_modules', 'dist', '.git', '.plugin'])
export const LOCAL_PLUGIN_POLICY: PluginUploadPolicySnapshot = {
  maxZipBytes: 0,
  maxFileBytes: 0,
  maxTotalBytes: 0,
  maxFiles: 0,
  allowedContentTypes: [],
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

type LocalPluginInstallFile = {
  path: string
  mode?: string
}

function isAllowedLocalPluginFile(filePath: string): boolean {
  if (!isSafeRelativePath(filePath)) return false
  if (filePath.startsWith('.plugin/')) return false
  if (isBlockedExtension(filePath, LOCAL_PLUGIN_POLICY)) return false
  if (
    !isAllowedExtension(filePath, LOCAL_PLUGIN_POLICY) &&
    !isAllowedFilename(filePath, LOCAL_PLUGIN_POLICY)
  ) {
    return false
  }
  const isRootAllowedFile =
    !filePath.includes('/') && isAllowedFilename(filePath, LOCAL_PLUGIN_POLICY)
  const isInAllowedPrefix = LOCAL_PLUGIN_POLICY.allowedTargetPrefixes.some((prefix) =>
    filePath.startsWith(prefix)
  )
  return isRootAllowedFile || isInAllowedPrefix
}

async function walkLocalPluginFiles(
  rootDir: string,
  currentDir = rootDir
): Promise<LocalPluginInstallFile[]> {
  const fsModule = await import('node:fs/promises')
  const entries = await fsModule.readdir(currentDir, { withFileTypes: true })
  const files: LocalPluginInstallFile[] = []
  for (const entry of entries) {
    if (currentDir === rootDir && LOCAL_PLUGIN_EXCLUDE.has(entry.name)) continue
    const nextPath = path.join(currentDir, entry.name)
    const relativePath = path.relative(rootDir, nextPath).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (
        currentDir === rootDir &&
        !LOCAL_PLUGIN_POLICY.allowedTargetPrefixes.some((prefix) => prefix === `${entry.name}/`)
      ) {
        continue
      }
      files.push(...(await walkLocalPluginFiles(rootDir, nextPath)))
      continue
    }
    if (entry.isFile() && isAllowedLocalPluginFile(relativePath)) {
      const stat = await fsModule.stat(nextPath)
      files.push({
        path: relativePath,
        mode: (stat.mode & 0o111) !== 0 ? '755' : undefined,
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

async function resolveLocalFsPlugin(pluginRoot: string, manifestPath: string): Promise<ResolvedPlugin> {
  const fsModule = await import('node:fs/promises')
  const rawManifest = await readJsonFile<unknown>(manifestPath)
  if (!rawManifest) throw new Error(`Plugin manifest not found: ${manifestPath}`)
  const manifest = validatePluginManifest(rawManifest)
  const installMetadataPath = path.join(pluginRoot, '.plugin', 'install.json')
  const installMetadataExists = await fsModule
    .access(installMetadataPath)
    .then(() => true)
    .catch(() => false)
  const installMetadataRaw = installMetadataExists
    ? await readJsonFile<PluginInstallMetadata>(installMetadataPath).then((raw) =>
        validateInstallMetadata(raw, {
          label: `${installMetadataPath}`,
          requireNonEmpty: false,
        })
      )
    : null
  const hasInstallFiles = installMetadataRaw != null && installMetadataRaw.files.length > 0
  if (hasInstallFiles) {
    for (const file of installMetadataRaw!.files) {
      if (!isAllowedLocalPluginFile(file.path)) {
        throw new Error(
          `Local install.json references disallowed file "${file.path}". ` +
            'Remove it from install.json or delete install.json to use automatic file discovery.'
        )
      }
    }
  }
  const files = hasInstallFiles ? [] : await walkLocalPluginFiles(pluginRoot)
  return {
    manifest,
    installMetadata: hasInstallFiles
      ? installMetadataRaw
      : {
          files,
        },
    source: { type: 'fs', baseDir: pluginRoot },
    sourceLabel: `file:${manifestPath}`,
  }
}

export async function resolvePluginFromManifestSpec(spec: string, cwd: string): Promise<ResolvedPlugin> {
  if (isUrl(spec)) {
    const manifestUrl = spec
    if (!isCanonicalPluginManifestUrl(manifestUrl)) {
      throw new Error(
        `Remote plugin manifests must point to /.plugin/plugin.json. Received: ${manifestUrl}`
      )
    }
    const { baseUrl, installMetadataUrl } = deriveUrlPluginRoot(manifestUrl)
    const rawManifest = await fetchJson<unknown>(manifestUrl)
    const manifest = validatePluginManifest(rawManifest)
    const installMetadata = validateInstallMetadata(
      await fetchJson<PluginInstallMetadata>(installMetadataUrl),
      {
        label: `.plugin/install.json for URL plugin "${manifest.id}"`,
        requireNonEmpty: true,
        requireSha256: true,
      }
    )
    return {
      manifest,
      installMetadata,
      source: { type: 'url', baseUrl },
      sourceLabel: `url:${manifestUrl}`,
    }
  }

  const abs = path.isAbsolute(spec) ? spec : path.join(cwd, spec)
  const fsModule = await import('node:fs/promises')
  const stat = await fsModule.stat(abs).catch(() => null)
  if (!stat) throw new Error(`Plugin source not found: ${abs}`)

  if (stat.isDirectory()) {
    const pluginRoot = abs
    const manifestPath = path.join(pluginRoot, '.plugin', 'plugin.json')
    return resolveLocalFsPlugin(pluginRoot, manifestPath)
  }

  if (!isCanonicalPluginManifestPath(abs)) {
    throw new Error(
      `Local delivery manifests must point to .plugin/plugin.json or use a plugin directory root. Received: ${abs}`
    )
  }

  const pluginRoot = path.dirname(path.dirname(abs))
  return resolveLocalFsPlugin(pluginRoot, abs)
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
