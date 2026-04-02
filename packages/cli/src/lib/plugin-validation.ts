import type { PluginManifest, PluginUploadPolicySnapshot } from './types'

export const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
export const PLUGIN_VERSION_REGEX =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const PLUGIN_ID_MAX = 64
export const PLUGIN_VERSION_MAX = 64

export function isValidPluginId(id: string) {
  return Boolean(id) && id.length <= PLUGIN_ID_MAX && PLUGIN_ID_REGEX.test(id)
}

export function isValidPluginVersion(version: string) {
  return Boolean(version) && version.length <= PLUGIN_VERSION_MAX && PLUGIN_VERSION_REGEX.test(version)
}

export function isSafeRelativePath(value: string) {
  if (!value || value.startsWith('/') || value.startsWith('\\\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.endsWith('/..') ||
    normalized.includes('/../')
  ) {
    return false
  }
  return true
}

export function normalizeTopics(input?: Record<string, string[]>) {
  if (!input || typeof input !== 'object') return undefined
  const normalized: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!Array.isArray(value)) continue
    const cleaned = value.map((item) => String(item).trim()).filter(Boolean)
    if (cleaned.length) normalized[key] = cleaned
  }
  return Object.keys(normalized).length ? normalized : undefined
}

export function getPluginFileExtension(value: string) {
  const normalized = value.replace(/\\/g, '/')
  const last = normalized.split('/').pop() ?? ''
  const idx = last.lastIndexOf('.')
  if (idx <= 0) return ''
  return last.slice(idx)
}

export function isBlockedExtension(value: string, policy: PluginUploadPolicySnapshot) {
  const ext = getPluginFileExtension(value).toLowerCase()
  return policy.blockedExtensions.map((entry) => entry.toLowerCase()).includes(ext)
}

export function isAllowedExtension(value: string, policy: PluginUploadPolicySnapshot) {
  const ext = getPluginFileExtension(value)
  return Boolean(ext) && policy.allowedFileExtensions.includes(ext)
}

export function isAllowedFilename(value: string, policy: PluginUploadPolicySnapshot) {
  const normalized = value.replace(/\\/g, '/')
  const name = normalized.split('/').pop() ?? ''
  return policy.allowedFilenames.includes(name)
}

export function isProbablyBinary(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

export function validatePluginManifest(raw: unknown, policy?: PluginUploadPolicySnapshot): PluginManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('.plugin/plugin.json must be a JSON object')
  }

  const manifest = raw as Record<string, unknown>
  const id = String(manifest.id ?? '').trim()
  const name = String(manifest.name ?? '').trim()
  const description = String(manifest.description ?? '').trim()
  const version = String(manifest.version ?? '').trim()

  if (!isValidPluginId(id)) {
    throw new Error('Invalid plugin id')
  }
  if (!name) throw new Error('Plugin name is required')
  if (!description) throw new Error('Plugin description is required')
  if (!version) throw new Error('Plugin version is required')
  if (!isValidPluginVersion(version)) {
    throw new Error('Plugin version must be valid semver (x.y.z)')
  }

  if (manifest.kind !== 'agentrig:plugin') {
    throw new Error('Plugin kind must be "agentrig:plugin"')
  }

  if ('files' in manifest) {
    throw new Error('Canonical .plugin/plugin.json must not include delivery files metadata')
  }

  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.map((tag) => String(tag).trim()).filter(Boolean)
    : undefined

  const pluginDependencies = Array.isArray(manifest.pluginDependencies)
    ? manifest.pluginDependencies.map((dep) => String(dep).trim()).filter(Boolean)
    : undefined

  return {
    $schema: manifest.$schema ? String(manifest.$schema).trim() : undefined,
    kind: 'agentrig:plugin',
    id,
    name,
    description,
    version,
    author: manifest.author ? String(manifest.author).trim() : undefined,
    license: manifest.license ? String(manifest.license).trim() : undefined,
    keywords: keywords?.length ? keywords : undefined,
    pluginDependencies: pluginDependencies?.length ? pluginDependencies : undefined,
    configSchema: (() => {
      const cs = manifest.configSchema
      if (cs === undefined || cs === null || typeof cs !== 'object' || Array.isArray(cs)) {
        throw new Error('Plugin configSchema is required and must be a plain object')
      }
      return cs as Record<string, unknown>
    })(),
    'x-agentrig':
      manifest['x-agentrig'] && typeof manifest['x-agentrig'] === 'object'
        ? (manifest['x-agentrig'] as Record<string, unknown>)
        : undefined,
  }
}
