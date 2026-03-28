import type { PackFile, PackMeta, PackUploadPolicySnapshot } from './types'

export const PACK_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
export const PACK_VERSION_REGEX =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const PACK_NAME_MAX = 64
export const PACK_VERSION_MAX = 64

export function isValidPackName(name: string) {
  return Boolean(name) && name.length <= PACK_NAME_MAX && PACK_NAME_REGEX.test(name)
}

export function isValidPackVersion(version: string) {
  return Boolean(version) && version.length <= PACK_VERSION_MAX && PACK_VERSION_REGEX.test(version)
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

export function getPackFileExtension(value: string) {
  const normalized = value.replace(/\\/g, '/')
  const last = normalized.split('/').pop() ?? ''
  const idx = last.lastIndexOf('.')
  if (idx <= 0) return ''
  return last.slice(idx)
}

export function isBlockedExtension(value: string, policy: PackUploadPolicySnapshot) {
  const ext = getPackFileExtension(value).toLowerCase()
  return policy.blockedExtensions.map((entry) => entry.toLowerCase()).includes(ext)
}

export function isAllowedExtension(value: string, policy: PackUploadPolicySnapshot) {
  const ext = getPackFileExtension(value)
  return Boolean(ext) && policy.allowedFileExtensions.includes(ext)
}

export function isAllowedFilename(value: string, policy: PackUploadPolicySnapshot) {
  const normalized = value.replace(/\\/g, '/')
  const name = normalized.split('/').pop() ?? ''
  return policy.allowedFilenames.includes(name)
}

function normalizeTargetForValidation(value: string) {
  return value
    .replace(/\{\{skillsDir\}\}/g, '.codex/skills')
    .replace(/\{\{[^}]+\}\}/g, '')
}

export function isAllowedTarget(value: string, policy: PackUploadPolicySnapshot) {
  if (!value) return false
  const normalized = normalizeTargetForValidation(value)
  if (!normalized || !isSafeRelativePath(normalized)) return false
  const posix = normalized.replace(/\\/g, '/')
  return policy.allowedTargetPrefixes.some((prefix) => posix.startsWith(prefix))
}

export function isProbablyBinary(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

function normalizePackFile(file: Record<string, unknown>, policy: PackUploadPolicySnapshot): PackFile {
  const filePath = String(file.path ?? '').trim()
  const target = String(file.target ?? '').trim()
  const mode = file.mode ? String(file.mode).trim() : undefined

  if (!filePath || !isSafeRelativePath(filePath)) {
    throw new Error(`Invalid file path: ${filePath || '<empty>'}`)
  }
  if (!target || !isAllowedTarget(target, policy)) {
    throw new Error(`Invalid target for file path: ${filePath}`)
  }

  return {
    path: filePath,
    target,
    mode,
    sha256: file.sha256 ? String(file.sha256).trim() : undefined,
  }
}

export function validatePackMeta(raw: unknown, policy: PackUploadPolicySnapshot): PackMeta {
  if (!raw || typeof raw !== 'object') {
    throw new Error('meta.json must be a JSON object')
  }

  const meta = raw as Record<string, unknown>
  const name = String(meta.name ?? '').trim()
  const title = String(meta.title ?? '').trim()
  const description = String(meta.description ?? '').trim()
  const version = String(meta.version ?? '').trim()

  if (!isValidPackName(name)) {
    throw new Error('Invalid pack name')
  }
  if (!title) throw new Error('Pack title is required')
  if (!description) throw new Error('Pack description is required')
  if (!version) throw new Error('Pack version is required')
  if (!isValidPackVersion(version)) {
    throw new Error('Pack version must be valid semver (x.y.z)')
  }

  if (!Array.isArray(meta.files) || meta.files.length === 0) {
    throw new Error('Pack files must be a non-empty array')
  }

  const pathSet = new Set<string>()
  const targetSet = new Set<string>()

  const files = meta.files.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Pack file entry must be an object')
    }
    const normalized = normalizePackFile(entry as Record<string, unknown>, policy)
    if (pathSet.has(normalized.path)) {
      throw new Error(`Duplicate file path: ${normalized.path}`)
    }
    if (targetSet.has(normalized.target)) {
      throw new Error(`Duplicate target path: ${normalized.target}`)
    }
    pathSet.add(normalized.path)
    targetSet.add(normalized.target)
    return normalized
  })

  const tags = Array.isArray(meta.tags)
    ? meta.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : undefined

  const rigDependencies = Array.isArray(meta.rigDependencies)
    ? meta.rigDependencies.map((dep) => String(dep).trim()).filter(Boolean)
    : undefined

  return {
    $schema: meta.$schema ? String(meta.$schema).trim() : undefined,
    kind: meta.kind === 'agentrig:pack' ? 'agentrig:pack' : undefined,
    name,
    title,
    description,
    version,
    author: meta.author ? String(meta.author).trim() : undefined,
    license: meta.license ? String(meta.license).trim() : undefined,
    tags: tags?.length ? tags : undefined,
    topics: normalizeTopics(meta.topics as Record<string, string[]> | undefined),
    rigDependencies: rigDependencies?.length ? rigDependencies : undefined,
    files,
    components:
      meta.components && typeof meta.components === 'object'
        ? (meta.components as PackMeta['components'])
        : undefined,
  }
}
