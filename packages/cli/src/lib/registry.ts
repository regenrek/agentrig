import process from 'node:process'
import { sha256Hex } from './hash'
import { validatePluginManifest } from './plugin-validation'
import { INSTALLABILITY_STATES, REGISTRY_TRUST_TIERS } from './registry-contract'
import {
  artifactKindFromStandaloneManifest,
  parseStandaloneArtifactManifest,
  type ArtifactKind,
  type StandaloneArtifactManifest,
} from '@agentrig/sdk'
import type {
  PluginManifest,
  RegistryIndex,
  RegistryRef,
  RegistryHistory,
  RegistryInstallability,
  RegistryLock,
  RegistryReview,
  RegistrySource,
  RegistryVersionRecord,
  PluginUploadPolicySnapshot,
  TrustTier,
} from './types'

export const OFFICIAL_REGISTRY_ALIAS = 'agentrig'
export const OFFICIAL_REGISTRY_URL =
  process.env.AGENTRIG_OFFICIAL_REGISTRY_URL ?? 'https://agentrig.ai/registry'
const OFFICIAL_REGISTRY_KEY_ID = 'agentrig-registry'
const OFFICIAL_REGISTRY_SOURCE_REPOSITORY = 'https://github.com/agentrig/agentrig-registry'
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DIGEST_EXCLUDED_RELATIVE_PATHS = new Set([
  'AGENTRIG_LOCK.json',
  'AGENTRIG_REVIEW.json',
  'AGENTRIG_SOURCE.json',
])
const REGISTRY_ARTIFACT_KINDS = ['plugin', 'skill', 'mcp', 'hook'] as const

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

export type SourceBase =
  { type: 'url'; baseUrl: string }

export type ResolvedPlugin = {
  manifest: PluginManifest
  registryDocument: RegistryIndex
  history: RegistryHistory
  versionRecord: RegistryVersionRecord
  lockArtifact: RegistryLock
  sourceArtifact: RegistrySource
  reviewArtifact: RegistryReview
  snapshotDigest: string
  source: SourceBase
  sourceLabel: string
  trustTier: TrustTier
  installability: RegistryInstallability
  registry: RegistryRef
}

export type StandaloneRegistryArtifactKind = Extract<ArtifactKind, 'skill' | 'mcp' | 'hook'>

export type ResolvedStandaloneArtifact = {
  artifactKind: StandaloneRegistryArtifactKind
  artifactId: string
  manifest: StandaloneArtifactManifest
  registryDocument: RegistryIndex
  history: RegistryHistory
  versionRecord: RegistryVersionRecord
  lockArtifact: RegistryLock
  sourceArtifact: RegistrySource
  reviewArtifact: RegistryReview
  snapshotDigest: string
  source: SourceBase
  sourceLabel: string
  trustTier: TrustTier
  installability: RegistryInstallability
  registry: RegistryRef
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function expectRecord(value: unknown, where: string): Record<string, unknown> {
  assert(isRecord(value), `Invalid ${where}: expected an object`)
  return value
}

function expectString(value: unknown, where: string) {
  assert(typeof value === 'string' && value.trim().length > 0, `Invalid ${where}: expected a non-empty string`)
  return value.trim()
}

function expectStringArray(value: unknown, where: string) {
  assert(Array.isArray(value), `Invalid ${where}: expected an array`)
  return value.map((entry, index) => expectString(entry, `${where}[${index}]`))
}

function expectDate(value: unknown, where: string) {
  const normalized = expectString(value, where)
  assert(ISO_DATE_PATTERN.test(normalized), `Invalid ${where}: expected an ISO UTC timestamp`)
  return normalized
}

function expectSha256Digest(value: unknown, where: string) {
  const normalized = expectString(value, where)
  assert(SHA256_PATTERN.test(normalized), `Invalid ${where}: expected sha256:<hex>`)
  return normalized
}

export function joinUrl(baseUrl: string, rel: string) {
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

export function normalizeRegistryUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function isCanonicalRelativePath(value: string, options: { allowRoot?: boolean } = {}) {
  if (!value || value.startsWith('/') || value.startsWith('\\')) return false
  if (value.includes('\0')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false
  const normalized = value.replace(/\\/g, '/')
  if (options.allowRoot && normalized === '.') return true
  if (normalized.includes('//')) return false
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return false
  }
  return true
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

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeys(entry))
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)])
  )
}

function stableJson(value: unknown) {
  return JSON.stringify(sortKeys(value))
}

function digestJsonEnvelope(value: unknown) {
  return `sha256:${sha256Hex(new TextEncoder().encode(stableJson(value)))}`
}

function splitPluginId(pluginId: string) {
  const [namespace, pluginName, extra] = pluginId.split('.')
  assert(namespace && pluginName && !extra, `Invalid plugin id: ${pluginId}`)
  return { namespace, pluginName }
}

function splitArtifactId(artifactId: string) {
  const [namespace, artifactName, extra] = artifactId.split('.')
  assert(namespace && artifactName && !extra, `Invalid artifact id: ${artifactId}`)
  return { namespace, artifactName }
}

function expectArtifactKind(value: unknown, where: string): ArtifactKind {
  const kind = expectString(value, where) as ArtifactKind
  assert((REGISTRY_ARTIFACT_KINDS as readonly string[]).includes(kind), `Invalid ${where}: ${kind}`)
  return kind
}

function artifactLayout(kind: ArtifactKind) {
  if (kind === 'plugin') return { root: 'plugins', historyFile: 'plugin.json', manifestDir: '.plugin', manifestFile: 'plugin.json' }
  if (kind === 'skill') return { root: 'skills', historyFile: 'skill.json', manifestDir: '.skill', manifestFile: 'skill.json' }
  if (kind === 'mcp') return { root: 'mcps', historyFile: 'mcp.json', manifestDir: '.mcp', manifestFile: 'mcp.json' }
  if (kind === 'hook') return { root: 'hooks', historyFile: 'hook.json', manifestDir: '.hook', manifestFile: 'hook.json' }
  throw new Error(`Unsupported registry artifact kind: ${kind}`)
}

export function registryArtifactSourcePath(kind: StandaloneRegistryArtifactKind, artifactId: string) {
  const { artifactName } = splitArtifactId(artifactId)
  return `${artifactLayout(kind).root}/${artifactName}`
}

function expectedVersionRoot(kind: ArtifactKind, artifactId: string, version: string) {
  const { namespace, artifactName } = splitArtifactId(artifactId)
  const layout = artifactLayout(kind)
  return `${layout.root}/${namespace}/${artifactName}/versions/${version}/`
}

function expectedHistoryPath(kind: ArtifactKind, artifactId: string) {
  const { namespace, artifactName } = splitArtifactId(artifactId)
  const layout = artifactLayout(kind)
  return `${layout.root}/${namespace}/${artifactName}/${layout.historyFile}`
}

function mapInstallability(trustTier: TrustTier): RegistryInstallability {
  switch (trustTier) {
    case 'official':
    case 'reviewed':
      return 'installable'
    case 'listed':
      return 'discovery_only'
    case 'blocked':
      return 'blocked'
    case 'yanked':
      return 'yanked'
  }
}

function validateVersionRecord(
  raw: unknown,
  kind: ArtifactKind,
  artifactId: string,
  where: string
): RegistryVersionRecord {
  const record = expectRecord(raw, where)
  const version = expectString(record.version, `${where}.version`)
  assert(VERSION_PATTERN.test(version), `Invalid ${where}.version: expected exact semver`)
  const root = expectedVersionRoot(kind, artifactId, version)
  const layout = artifactLayout(kind)
  const trustTier = expectString(record.trust_tier, `${where}.trust_tier`) as TrustTier
  assert(REGISTRY_TRUST_TIERS.includes(trustTier), `Invalid ${where}.trust_tier: ${trustTier}`)
  const installability = expectString(record.installability, `${where}.installability`) as RegistryInstallability
  assert(INSTALLABILITY_STATES.includes(installability), `Invalid ${where}.installability: ${installability}`)
  assert(
    installability === mapInstallability(trustTier),
    `Invalid ${where}.installability: expected "${mapInstallability(trustTier)}"`
  )
  const normalized: RegistryVersionRecord = {
    version,
    path: expectString(record.path, `${where}.path`),
    manifest: expectString(record.manifest, `${where}.manifest`),
    source: expectString(record.source, `${where}.source`),
    lock: expectString(record.lock, `${where}.lock`),
    review: expectString(record.review, `${where}.review`),
    trust_tier: trustTier,
    installability,
    snapshot_digest: expectSha256Digest(record.snapshot_digest, `${where}.snapshot_digest`),
    published_at: expectDate(record.published_at, `${where}.published_at`),
  }
  assert(normalized.path === root, `Invalid ${where}.path: expected "${root}"`)
  assert(
    normalized.manifest === `${root}${layout.manifestDir}/${layout.manifestFile}`,
    `Invalid ${where}.manifest: expected "${root}${layout.manifestDir}/${layout.manifestFile}"`
  )
  assert(
    normalized.source === `${root}AGENTRIG_SOURCE.json`,
    `Invalid ${where}.source: expected "${root}AGENTRIG_SOURCE.json"`
  )
  assert(
    normalized.lock === `${root}AGENTRIG_LOCK.json`,
    `Invalid ${where}.lock: expected "${root}AGENTRIG_LOCK.json"`
  )
  assert(
    normalized.review === `${root}AGENTRIG_REVIEW.json`,
    `Invalid ${where}.review: expected "${root}AGENTRIG_REVIEW.json"`
  )
  return normalized
}

function validateRegistryItem(raw: unknown, where: string): RegistryIndex['items'][number] {
  const item = expectRecord(raw, where)
  const kind = item.kind == null ? 'plugin' : expectArtifactKind(item.kind, `${where}.kind`)
  const artifact = item.artifact == null && kind === 'plugin'
    ? expectString(item.plugin, `${where}.plugin`)
    : expectString(item.artifact, `${where}.artifact`)
  splitArtifactId(artifact)
  const pluginId = item.plugin == null && kind === 'plugin'
    ? artifact
    : item.plugin == null ? undefined : expectString(item.plugin, `${where}.plugin`)
  if (kind === 'plugin') {
    assert(pluginId === artifact, `Invalid ${where}.plugin: expected "${artifact}"`)
  } else {
    assert(pluginId == null, `Invalid ${where}.plugin: standalone artifact rows must not carry plugin aliases`)
  }
  const latestVersion = expectString(item.latest_version, `${where}.latest_version`)
  assert(VERSION_PATTERN.test(latestVersion), `Invalid ${where}.latest_version: expected exact semver`)
  const trustTier = expectString(item.trust_tier, `${where}.trust_tier`) as TrustTier
  assert(REGISTRY_TRUST_TIERS.includes(trustTier), `Invalid ${where}.trust_tier: ${trustTier}`)
  const installability = expectString(item.installability, `${where}.installability`) as RegistryInstallability
  assert(INSTALLABILITY_STATES.includes(installability), `Invalid ${where}.installability: ${installability}`)
  assert(
    installability === mapInstallability(trustTier),
    `Invalid ${where}.installability: expected "${mapInstallability(trustTier)}"`
  )
  const history = expectString(item.history, `${where}.history`)
  assert(
    history === expectedHistoryPath(kind, artifact),
    `Invalid ${where}.history: expected "${expectedHistoryPath(kind, artifact)}"`
  )
  const activeVersion = validateVersionRecord(item.active_version, kind, artifact, `${where}.active_version`)
  assert(
    activeVersion.version === latestVersion,
    `Invalid ${where}.active_version.version: expected "${latestVersion}"`
  )
  assert(
    activeVersion.trust_tier === trustTier,
    `Invalid ${where}.active_version.trust_tier: expected "${trustTier}"`
  )
  assert(
    activeVersion.installability === installability,
    `Invalid ${where}.active_version.installability: expected "${installability}"`
  )
  return {
    kind,
    artifact,
    plugin: pluginId,
    name: expectString(item.name, `${where}.name`),
    description: expectString(item.description, `${where}.description`),
    latest_version: latestVersion,
    history,
    active_version: activeVersion,
    trust_tier: trustTier,
    installability,
    keywords: item.keywords == null ? undefined : expectStringArray(item.keywords, `${where}.keywords`),
    advisories: item.advisories == null ? undefined : expectStringArray(item.advisories, `${where}.advisories`),
  }
}

function validateRegistryDocument(
  raw: unknown,
  expectedAlias: string,
  expectedUrl: string
): RegistryIndex {
  const document = expectRecord(raw, 'registry.json')
  const signature = expectRecord(document.signature, 'registry.json.signature')
  const items = Array.isArray(document.items)
    ? document.items.map((entry, index) => validateRegistryItem(entry, `registry.json.items[${index}]`))
    : (() => { throw new Error('Invalid registry.json.items: expected an array') })()
  const normalized: RegistryIndex = {
    $schema: typeof document.$schema === 'string' ? document.$schema : undefined,
    contract_version: expectString(document.contract_version, 'registry.json.contract_version'),
    registry_alias: expectString(document.registry_alias, 'registry.json.registry_alias'),
    source_repository: expectString(document.source_repository, 'registry.json.source_repository'),
    generated_at: expectDate(document.generated_at, 'registry.json.generated_at'),
    signature: {
      algorithm: expectString(signature.algorithm, 'registry.json.signature.algorithm'),
      key_id: expectString(signature.key_id, 'registry.json.signature.key_id'),
      target: expectString(signature.target, 'registry.json.signature.target'),
      signed_digest: expectSha256Digest(signature.signed_digest, 'registry.json.signature.signed_digest'),
    },
    items,
  }
  assert(normalized.contract_version === '1', 'Invalid registry.json.contract_version: expected "1"')
  assert(
    normalized.registry_alias === expectedAlias,
    `Registry alias mismatch for ${expectedUrl}: expected "${expectedAlias}", got "${normalized.registry_alias}".`
  )
  assert(
    normalized.signature.algorithm === 'sha256-json-envelope',
    'Invalid registry.json.signature.algorithm: expected "sha256-json-envelope"'
  )
  assert(
    normalized.signature.target === 'registry.json',
    'Invalid registry.json.signature.target: expected "registry.json"'
  )
  if (expectedAlias === OFFICIAL_REGISTRY_ALIAS) {
    assert(
      normalized.signature.key_id === OFFICIAL_REGISTRY_KEY_ID,
      `Invalid registry.json.signature.key_id for ${expectedAlias}: expected "${OFFICIAL_REGISTRY_KEY_ID}".`
    )
    assert(
      normalized.source_repository === OFFICIAL_REGISTRY_SOURCE_REPOSITORY,
      `Invalid registry.json.source_repository for ${expectedAlias}: expected "${OFFICIAL_REGISTRY_SOURCE_REPOSITORY}".`
    )
  }
  const unsignedPayload = {
    $schema: typeof document.$schema === 'string' ? document.$schema : undefined,
    contract_version: document.contract_version,
    registry_alias: document.registry_alias,
    source_repository: document.source_repository,
    generated_at: document.generated_at,
    items: document.items,
  }
  const actualDigest = digestJsonEnvelope(unsignedPayload)
  assert(
    normalized.signature.signed_digest === actualDigest,
    `Registry signature verification failed for ${expectedAlias}: digest mismatch.`
  )
  return normalized
}

function validateHistoryDocument(
  raw: unknown,
  kind: ArtifactKind,
  artifactId: string,
  expectedHistoryPath: string
): RegistryHistory {
  const history = expectRecord(raw, expectedHistoryPath)
  const versions = Array.isArray(history.versions)
    ? history.versions.map((entry, index) =>
        validateVersionRecord(entry, kind, artifactId, `${expectedHistoryPath}.versions[${index}]`)
      )
    : (() => { throw new Error(`Invalid ${expectedHistoryPath}.versions: expected an array`) })()
  assert(versions.length > 0, `Invalid ${expectedHistoryPath}.versions: expected at least one version`)
  const activeVersion = validateVersionRecord(
    history.active_version,
    kind,
    artifactId,
    `${expectedHistoryPath}.active_version`
  )
  const trustTier = expectString(history.trust_tier, `${expectedHistoryPath}.trust_tier`) as TrustTier
  assert(REGISTRY_TRUST_TIERS.includes(trustTier), `Invalid ${expectedHistoryPath}.trust_tier: ${trustTier}`)
  const installability = expectString(history.installability, `${expectedHistoryPath}.installability`) as RegistryInstallability
  assert(
    INSTALLABILITY_STATES.includes(installability),
    `Invalid ${expectedHistoryPath}.installability: ${installability}`
  )
  assert(
    installability === mapInstallability(trustTier),
    `Invalid ${expectedHistoryPath}.installability: expected "${mapInstallability(trustTier)}"`
  )
  const latestVersion = expectString(history.latest_version, `${expectedHistoryPath}.latest_version`)
  const historyKind = history.kind == null ? 'plugin' : expectArtifactKind(history.kind, `${expectedHistoryPath}.kind`)
  assert(historyKind === kind, `Invalid ${expectedHistoryPath}.kind: expected "${kind}"`)
  const artifact = history.artifact == null
    ? expectString(history.plugin, `${expectedHistoryPath}.plugin`)
    : expectString(history.artifact, `${expectedHistoryPath}.artifact`)
  const plugin = history.plugin == null ? undefined : expectString(history.plugin, `${expectedHistoryPath}.plugin`)
  const normalized: RegistryHistory = {
    $schema: typeof history.$schema === 'string' ? history.$schema : undefined,
    kind: historyKind,
    artifact,
    plugin: kind === 'plugin' ? plugin ?? artifact : plugin,
    namespace: expectString(history.namespace, `${expectedHistoryPath}.namespace`),
    name: expectString(history.name, `${expectedHistoryPath}.name`),
    description: expectString(history.description, `${expectedHistoryPath}.description`),
    latest_version: latestVersion,
    trust_tier: trustTier,
    installability,
    active_version: activeVersion,
    keywords: history.keywords == null ? undefined : expectStringArray(history.keywords, `${expectedHistoryPath}.keywords`),
    advisories: history.advisories == null ? undefined : expectStringArray(history.advisories, `${expectedHistoryPath}.advisories`),
    versions,
  }
  assert(normalized.artifact === artifactId, `Invalid ${expectedHistoryPath}.artifact: expected "${artifactId}"`)
  if (kind === 'plugin') {
    assert(normalized.plugin === artifactId, `Invalid ${expectedHistoryPath}.plugin: expected "${artifactId}"`)
  } else {
    assert(normalized.plugin == null, `Invalid ${expectedHistoryPath}.plugin: standalone artifact histories must not carry plugin aliases`)
  }
  assert(
    `${normalized.namespace}.${splitArtifactId(artifactId).artifactName}` === artifactId,
    `Invalid ${expectedHistoryPath}.namespace for "${artifactId}".`
  )
  assert(
    activeVersion.version === latestVersion,
    `Invalid ${expectedHistoryPath}.active_version.version: expected "${latestVersion}"`
  )
  assert(
    activeVersion.trust_tier === trustTier,
    `Invalid ${expectedHistoryPath}.active_version.trust_tier: expected "${trustTier}"`
  )
  assert(
    activeVersion.installability === installability,
    `Invalid ${expectedHistoryPath}.active_version.installability: expected "${installability}"`
  )
  return normalized
}

function validateFileDigests(raw: unknown, where: string) {
  assert(Array.isArray(raw), `Invalid ${where}: expected an array`)
  let previousPath: string | null = null
  const seenPaths = new Set<string>()
  return raw.map((entry, index) => {
    const digestEntry = expectRecord(entry, `${where}[${index}]`)
    const filePath = expectString(digestEntry.path, `${where}[${index}].path`)
    assert(
      isCanonicalRelativePath(filePath) && !DIGEST_EXCLUDED_RELATIVE_PATHS.has(filePath),
      `Invalid ${where}[${index}].path: ${filePath}`
    )
    assert(!seenPaths.has(filePath), `Invalid ${where}: duplicate digest path "${filePath}"`)
    if (previousPath != null) {
      assert(previousPath.localeCompare(filePath) < 0, `Invalid ${where}: file_digests must be sorted by path`)
    }
    seenPaths.add(filePath)
    previousPath = filePath
    return {
      path: filePath,
      digest: expectSha256Digest(digestEntry.digest, `${where}[${index}].digest`),
    }
  })
}

function validateLockArtifact(
  raw: unknown,
  kind: ArtifactKind,
  artifactId: string,
  version: string,
  expectedSnapshotDigest: string,
  where: string
): RegistryLock {
  const artifact = expectRecord(raw, where)
  const fileDigests = validateFileDigests(artifact.file_digests, `${where}.file_digests`)
  const rawDependencies = Array.isArray(artifact.dependencies)
    ? artifact.dependencies
    : (() => { throw new Error(`Invalid ${where}.dependencies: expected an array`) })()
  const dependencies = kind === 'plugin'
    ? rawDependencies.map((entry, index) => {
      const dependency = expectRecord(entry, `${where}.dependencies[${index}]`)
      const plugin = expectString(dependency.plugin, `${where}.dependencies[${index}].plugin`)
      const dependencyVersion = expectString(
        dependency.version,
        `${where}.dependencies[${index}].version`
      )
      assert(VERSION_PATTERN.test(dependencyVersion), `Invalid ${where}.dependencies[${index}].version`)
      splitPluginId(plugin)
      return { plugin, version: dependencyVersion }
    })
    : (() => {
      assert(rawDependencies.length === 0, `Invalid ${where}.dependencies: standalone registry artifact dependencies are not supported`)
      return []
    })()
  const snapshotDigest = digestJsonEnvelope(fileDigests)
  assert(
    snapshotDigest === expectedSnapshotDigest,
    `Snapshot digest verification failed for ${artifactId}@${version}: lock file digest set does not match ${expectedSnapshotDigest}.`
  )
  const lockKind = artifact.artifact_kind == null ? 'plugin' : expectArtifactKind(artifact.artifact_kind, `${where}.artifact_kind`)
  const lockArtifactId = kind === 'plugin'
    ? expectString(artifact.plugin, `${where}.plugin`)
    : expectString(artifact.artifact_id, `${where}.artifact_id`)
  const normalized: RegistryLock = {
    $schema: typeof artifact.$schema === 'string' ? artifact.$schema : undefined,
    ...(kind === 'plugin' ? { plugin: lockArtifactId } : { artifact_kind: lockKind, artifact_id: lockArtifactId }),
    version: expectString(artifact.version, `${where}.version`),
    file_digests: fileDigests,
    capability_set: expectStringArray(artifact.capability_set, `${where}.capability_set`),
    declared_network_domains: expectStringArray(artifact.declared_network_domains, `${where}.declared_network_domains`),
    declared_secrets: expectStringArray(artifact.declared_secrets, `${where}.declared_secrets`),
    runtime_requirements: expectStringArray(artifact.runtime_requirements, `${where}.runtime_requirements`),
    dependencies,
    snapshot_digest: expectSha256Digest(artifact.snapshot_digest, `${where}.snapshot_digest`),
  }
  if (kind === 'plugin') {
    assert(normalized.plugin === artifactId, `Invalid ${where}.plugin: expected "${artifactId}"`)
  } else {
    assert(normalized.artifact_kind === kind, `Invalid ${where}.artifact_kind: expected "${kind}"`)
    assert(normalized.artifact_id === artifactId, `Invalid ${where}.artifact_id: expected "${artifactId}"`)
    assert(artifact.plugin == null, `Invalid ${where}.plugin: standalone registry artifact locks must not carry plugin aliases`)
  }
  assert(normalized.version === version, `Invalid ${where}.version: expected "${version}"`)
  assert(
    normalized.snapshot_digest === expectedSnapshotDigest,
    `Invalid ${where}.snapshot_digest: expected "${expectedSnapshotDigest}".`
  )
  return normalized
}

function validateSourceArtifact(
  raw: unknown,
  kind: ArtifactKind,
  expectedSnapshotDigest: string,
  where: string
): RegistrySource {
  const artifact = expectRecord(raw, where)
  const normalized: RegistrySource = {
    $schema: typeof artifact.$schema === 'string' ? artifact.$schema : undefined,
    upstream_repo: expectString(artifact.upstream_repo, `${where}.upstream_repo`),
    upstream_tag: expectString(artifact.upstream_tag, `${where}.upstream_tag`),
    upstream_commit: expectString(artifact.upstream_commit, `${where}.upstream_commit`),
    plugin_path: artifact.plugin_path == null ? undefined : expectString(artifact.plugin_path, `${where}.plugin_path`),
    artifact_kind: artifact.artifact_kind == null ? undefined : expectArtifactKind(artifact.artifact_kind, `${where}.artifact_kind`),
    artifact_path: artifact.artifact_path == null ? undefined : expectString(artifact.artifact_path, `${where}.artifact_path`),
    submitted_by: expectString(artifact.submitted_by, `${where}.submitted_by`),
    snapshot_created_at: expectDate(artifact.snapshot_created_at, `${where}.snapshot_created_at`),
    snapshot_tree_digest: expectSha256Digest(
      artifact.snapshot_tree_digest,
      `${where}.snapshot_tree_digest`
    ),
  }
  assert(
    normalized.snapshot_tree_digest === expectedSnapshotDigest,
    `Invalid ${where}.snapshot_tree_digest: expected "${expectedSnapshotDigest}".`
  )
  if (kind === 'plugin') {
    assert(
      normalized.plugin_path != null && isCanonicalRelativePath(normalized.plugin_path, { allowRoot: true }),
      `Invalid ${where}.plugin_path: expected a canonical relative path`
    )
  } else {
    assert(normalized.artifact_kind === kind, `Invalid ${where}.artifact_kind: expected "${kind}"`)
    assert(
      normalized.artifact_path != null && isCanonicalRelativePath(normalized.artifact_path),
      `Invalid ${where}.artifact_path: expected a canonical relative path`
    )
    assert(normalized.plugin_path == null, `Invalid ${where}.plugin_path: standalone registry artifact sources must not carry plugin paths`)
  }
  return normalized
}

function validateReviewArtifact(
  raw: unknown,
  trustTier: TrustTier,
  installability: RegistryInstallability,
  where: string
): RegistryReview {
  const artifact = expectRecord(raw, where)
  const scannerSummary = expectRecord(artifact.scanner_summary, `${where}.scanner_summary`)
  const trustTierBasis = expectRecord(artifact.trust_tier_basis, `${where}.trust_tier_basis`)
  const normalized: RegistryReview = {
    $schema: typeof artifact.$schema === 'string' ? artifact.$schema : undefined,
    review_status: expectString(artifact.review_status, `${where}.review_status`),
    reviewer: expectString(artifact.reviewer, `${where}.reviewer`),
    reviewed_at: expectDate(artifact.reviewed_at, `${where}.reviewed_at`),
    scanner_summary: {
      status: expectString(scannerSummary.status, `${where}.scanner_summary.status`),
      findings: scannerSummary.findings == null
        ? undefined
        : expectStringArray(scannerSummary.findings, `${where}.scanner_summary.findings`),
    },
    policy_decisions: expectStringArray(artifact.policy_decisions, `${where}.policy_decisions`),
    trust_tier_basis: {
      trust_tier: expectString(trustTierBasis.trust_tier, `${where}.trust_tier_basis.trust_tier`) as TrustTier,
      installability: expectString(
        trustTierBasis.installability,
        `${where}.trust_tier_basis.installability`
      ) as RegistryInstallability,
      rationale: expectString(trustTierBasis.rationale, `${where}.trust_tier_basis.rationale`),
    },
  }
  assert(
    normalized.trust_tier_basis.trust_tier === trustTier,
    `Invalid ${where}.trust_tier_basis.trust_tier: expected "${trustTier}".`
  )
  assert(
    normalized.trust_tier_basis.installability === installability,
    `Invalid ${where}.trust_tier_basis.installability: expected "${installability}".`
  )
  return normalized
}

export function resolveConfiguredRegistry(
  alias: string,
  registries: RegistryRef[]
): RegistryRef {
  if (alias === OFFICIAL_REGISTRY_ALIAS) {
    const configured = registries.find((entry) => entry.name === alias)
    return configured
      ? { name: configured.name, url: normalizeRegistryUrl(configured.url) }
      : {
      name: OFFICIAL_REGISTRY_ALIAS,
      url: normalizeRegistryUrl(OFFICIAL_REGISTRY_URL),
    }
  }
  const registry = registries.find((entry) => entry.name === alias)
  if (!registry) {
    throw new Error(
      `Unknown registry alias "${alias}". Add it first with:\n` +
        `agentrig registry add ${alias} <baseUrl>`
    )
  }
  return {
    name: registry.name,
    url: normalizeRegistryUrl(registry.url),
  }
}

export async function readRegistryIndex(registry: RegistryRef): Promise<RegistryIndex> {
  const registryUrl = normalizeRegistryUrl(registry.url)
  const raw = await fetchJson<unknown>(joinUrl(registryUrl, 'registry.json'))
  return validateRegistryDocument(raw, registry.name, registryUrl)
}

async function readHistoryDocument(
  registry: RegistryRef,
  registryDocument: RegistryIndex,
  kind: ArtifactKind,
  artifactId: string
) {
  const item = registryDocument.items.find((entry) => entry.kind === kind && entry.artifact === artifactId)
  if (!item) {
    throw new Error(`Unknown ${kind} "${artifactId}" in registry "${registry.name}".`)
  }
  const raw = await fetchJson<unknown>(joinUrl(registry.url, item.history))
  const history = validateHistoryDocument(raw, kind, artifactId, item.history)
  assert(
    history.latest_version === item.latest_version,
    `Registry history mismatch for "${artifactId}": latest version drift.`
  )
  assert(
    history.trust_tier === item.trust_tier,
    `Registry history mismatch for "${artifactId}": trust tier drift.`
  )
  assert(
    history.installability === item.installability,
    `Registry history mismatch for "${artifactId}": installability drift.`
  )
  return history
}

export async function readSourceFile(source: SourceBase, relPath: string): Promise<Uint8Array> {
  const url = joinUrl(source.baseUrl, relPath)
  const res = await fetchWithTimeout(url, {})
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function resolvePluginFromRegistryRef(
  registry: RegistryRef,
  pluginId: string,
  version: string
): Promise<ResolvedPlugin> {
  const normalizedRegistry: RegistryRef = {
    name: registry.name,
    url: normalizeRegistryUrl(registry.url),
  }
  const registryDocument = await readRegistryIndex(normalizedRegistry)
  const history = await readHistoryDocument(normalizedRegistry, registryDocument, 'plugin', pluginId)
  const versionRecord = history.versions.find((entry) => entry.version === version)
  if (!versionRecord) {
    throw new Error(
      `Unknown version "${version}" for plugin "${pluginId}" in registry "${normalizedRegistry.name}".`
    )
  }

  const [manifestRaw, lockRaw, sourceRaw, reviewRaw] = await Promise.all([
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.manifest)),
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.lock)),
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.source)),
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.review)),
  ])
  const manifest = validatePluginManifest(manifestRaw)
  assert(manifest.id === pluginId, `Registry manifest id mismatch for "${pluginId}".`)
  assert(manifest.version === version, `Registry manifest version mismatch for "${pluginId}@${version}".`)
  const lockArtifact = validateLockArtifact(
    lockRaw,
    'plugin',
    pluginId,
    version,
    versionRecord.snapshot_digest,
    versionRecord.lock
  )
  const sourceArtifact = validateSourceArtifact(
    sourceRaw,
    'plugin',
    versionRecord.snapshot_digest,
    versionRecord.source
  )
  const reviewArtifact = validateReviewArtifact(
    reviewRaw,
    versionRecord.trust_tier,
    versionRecord.installability,
    versionRecord.review
  )
  return {
    manifest,
    registryDocument,
    history,
    versionRecord,
    lockArtifact,
    sourceArtifact,
    reviewArtifact,
    snapshotDigest: versionRecord.snapshot_digest,
    source: { type: 'url', baseUrl: joinUrl(normalizedRegistry.url, versionRecord.path) },
    sourceLabel: `${normalizedRegistry.name}/${pluginId}@${version}`,
    trustTier: versionRecord.trust_tier,
    installability: versionRecord.installability,
    registry: normalizedRegistry,
  }
}

export async function resolveStandaloneArtifactFromRegistryRef(
  registry: RegistryRef,
  artifactKind: StandaloneRegistryArtifactKind,
  artifactId: string,
  version: string
): Promise<ResolvedStandaloneArtifact> {
  const normalizedRegistry: RegistryRef = {
    name: registry.name,
    url: normalizeRegistryUrl(registry.url),
  }
  const registryDocument = await readRegistryIndex(normalizedRegistry)
  const history = await readHistoryDocument(normalizedRegistry, registryDocument, artifactKind, artifactId)
  const versionRecord = history.versions.find((entry) => entry.version === version)
  if (!versionRecord) {
    throw new Error(
      `Unknown version "${version}" for ${artifactKind} "${artifactId}" in registry "${normalizedRegistry.name}".`
    )
  }

  const [manifestRaw, lockRaw, sourceRaw, reviewRaw] = await Promise.all([
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.manifest)),
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.lock)),
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.source)),
    fetchJson<unknown>(joinUrl(normalizedRegistry.url, versionRecord.review)),
  ])
  const manifest = parseStandaloneArtifactManifest(manifestRaw)
  assert(
    artifactKindFromStandaloneManifest(manifest) === artifactKind,
    `Registry manifest kind mismatch for "${artifactId}".`
  )
  assert(manifest.id === artifactId, `Registry manifest id mismatch for "${artifactId}".`)
  assert(manifest.version === version, `Registry manifest version mismatch for "${artifactId}@${version}".`)
  const lockArtifact = validateLockArtifact(
    lockRaw,
    artifactKind,
    artifactId,
    version,
    versionRecord.snapshot_digest,
    versionRecord.lock
  )
  const sourceArtifact = validateSourceArtifact(
    sourceRaw,
    artifactKind,
    versionRecord.snapshot_digest,
    versionRecord.source
  )
  const reviewArtifact = validateReviewArtifact(
    reviewRaw,
    versionRecord.trust_tier,
    versionRecord.installability,
    versionRecord.review
  )
  return {
    artifactKind,
    artifactId,
    manifest,
    registryDocument,
    history,
    versionRecord,
    lockArtifact,
    sourceArtifact,
    reviewArtifact,
    snapshotDigest: versionRecord.snapshot_digest,
    source: { type: 'url', baseUrl: joinUrl(normalizedRegistry.url, versionRecord.path) },
    sourceLabel: `${normalizedRegistry.name}/${artifactId}@${version}`,
    trustTier: versionRecord.trust_tier,
    installability: versionRecord.installability,
    registry: normalizedRegistry,
  }
}

export async function resolvePluginFromRegistryAlias(
  alias: string,
  pluginId: string,
  version: string,
  registries: RegistryRef[]
): Promise<ResolvedPlugin> {
  const registry = resolveConfiguredRegistry(alias, registries)
  return resolvePluginFromRegistryRef(registry, pluginId, version)
}

export async function resolveStandaloneArtifact(
  alias: string,
  artifactKind: StandaloneRegistryArtifactKind,
  artifactId: string,
  version: string,
  registries: RegistryRef[]
): Promise<ResolvedStandaloneArtifact> {
  const registry = resolveConfiguredRegistry(alias, registries)
  return resolveStandaloneArtifactFromRegistryRef(registry, artifactKind, artifactId, version)
}
