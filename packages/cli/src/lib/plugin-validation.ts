import { PluginManifestSchema } from '@agentrig/sdk'
import type { PluginManifest, PluginUploadPolicySnapshot } from './types'

export { isValidPluginName } from '@agentrig/sdk'

export const PLUGIN_VERSION_REGEX =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const PLUGIN_VERSION_MAX = 64

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

export function validatePluginManifest(raw: unknown, _policy?: PluginUploadPolicySnapshot): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid .plugin/plugin.json: ${issue?.message ?? 'invalid data'}`)
  }
  return parsed.data
}
