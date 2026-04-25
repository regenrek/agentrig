const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/

export type VirtualTreeEntryKind = 'file' | 'directory'

export type VirtualTreeEntry = {
  path: string
  kind: VirtualTreeEntryKind
  bytes?: number
  sha256?: string
}

export type VirtualTreeFile = VirtualTreeEntry & {
  kind: 'file'
  bytes: number
  sha256: string
}

export type VirtualTree = {
  listEntries(): Promise<VirtualTreeEntry[]>
  readText(path: string): Promise<string | null>
  readBytes?(path: string): Promise<Uint8Array | null>
}

export function normalizeVirtualPath(input: string) {
  if (!input || input.trim() !== input || input.startsWith('/') || input.startsWith('\\\\') || WINDOWS_DRIVE_RE.test(input)) {
    throw new Error(`Unsafe virtual path: ${input}`)
  }

  const withPosixSeparators = input.replace(/\\/g, '/')
  const withoutPrefix = withPosixSeparators.replace(/^\.\/+/, '')
  const segments: string[] = []

  for (const rawSegment of withoutPrefix.split('/')) {
    if (!rawSegment || rawSegment === '.') continue
    if (rawSegment !== rawSegment.trim() || rawSegment === '..') {
      throw new Error(`Unsafe virtual path: ${input}`)
    }
    segments.push(rawSegment)
  }

  const normalized = segments.join('/')
  if (!normalized) {
    throw new Error(`Unsafe virtual path: ${input}`)
  }
  return normalized
}

export function isSafeVirtualPath(input: string) {
  try {
    normalizeVirtualPath(input)
    return true
  } catch {
    return false
  }
}

export function assertSafeVirtualPath(input: string) {
  if (!isSafeVirtualPath(input)) {
    throw new Error(`Unsafe virtual path: ${input}`)
  }
  return normalizeVirtualPath(input)
}

export function sortVirtualPaths<T extends { path: string }>(items: readonly T[]) {
  return [...items].sort((left, right) => normalizeVirtualPath(left.path).localeCompare(normalizeVirtualPath(right.path)))
}

export function joinVirtualPath(...parts: string[]) {
  return normalizeVirtualPath(parts.filter(Boolean).join('/'))
}

export function virtualBasename(path: string) {
  const normalized = normalizeVirtualPath(path)
  return normalized.split('/').pop() ?? normalized
}

export function virtualDirname(path: string) {
  const normalized = normalizeVirtualPath(path)
  const parts = normalized.split('/')
  parts.pop()
  return parts.join('/')
}

export function virtualExtname(path: string) {
  const name = virtualBasename(path)
  const index = name.lastIndexOf('.')
  if (index <= 0) return ''
  return name.slice(index).toLowerCase()
}

export async function listVirtualFiles(tree: VirtualTree) {
  const entries = await tree.listEntries()
  return sortVirtualPaths(entries.filter((entry): entry is VirtualTreeFile => entry.kind === 'file'))
}
