import { normalizeVirtualPath, type VirtualTree } from '../repo-scan/virtual-tree'
import { createBufferedVirtualTree, sha256Hex } from './buffered-tree'

export type GitHubTreeEntry = {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export type GitHubTreeVirtualTreeOptions = {
  entries: readonly GitHubTreeEntry[]
  readBlob(entry: GitHubTreeEntry): Promise<Uint8Array | null>
  rootPath?: string
  maxFiles?: number
  maxBytes?: number
  includePath?: (path: string) => boolean
}

export type GitHubTreeSkippedEntry = {
  path: string
  reason: 'outside-root' | 'unsupported-entry' | 'excluded-path' | 'missing-size' | 'file-limit' | 'byte-limit' | 'blob-missing'
}

export type GitHubTreeVirtualTreeResult = {
  tree: VirtualTree
  fileCount: number
  totalBytes: number
  skipped: GitHubTreeSkippedEntry[]
}

type BufferedFile = {
  path: string
  bytes: Uint8Array
  sha256: string
}

const DEFAULT_MAX_FILES = 400
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export async function createGitHubTreeVirtualTree(options: GitHubTreeVirtualTreeOptions): Promise<GitHubTreeVirtualTreeResult> {
  const rootPath = normalizeOptionalRoot(options.rootPath)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const skipped: GitHubTreeSkippedEntry[] = []
  const files: BufferedFile[] = []
  let totalBytes = 0

  for (const entry of sortGitHubEntries(options.entries)) {
    const relativePath = relativeToRoot(entry.path, rootPath)
    if (!relativePath) {
      skipped.push({ path: entry.path, reason: 'outside-root' })
      continue
    }
    if (entry.type !== 'blob') {
      if (entry.type !== 'tree') skipped.push({ path: relativePath, reason: 'unsupported-entry' })
      continue
    }
    if (options.includePath && !options.includePath(relativePath)) {
      skipped.push({ path: relativePath, reason: 'excluded-path' })
      continue
    }
    if (typeof entry.size !== 'number' || entry.size < 0) {
      skipped.push({ path: relativePath, reason: 'missing-size' })
      continue
    }
    if (files.length >= maxFiles) {
      skipped.push({ path: relativePath, reason: 'file-limit' })
      continue
    }
    if (totalBytes + entry.size > maxBytes) {
      skipped.push({ path: relativePath, reason: 'byte-limit' })
      continue
    }
    const bytes = await options.readBlob(entry)
    if (!bytes) {
      skipped.push({ path: relativePath, reason: 'blob-missing' })
      continue
    }
    if (totalBytes + bytes.byteLength > maxBytes) {
      skipped.push({ path: relativePath, reason: 'byte-limit' })
      continue
    }
    files.push({
      path: relativePath,
      bytes,
      sha256: await sha256Hex(bytes),
    })
    totalBytes += bytes.byteLength
  }

  return {
    tree: await createBufferedVirtualTree(files),
    fileCount: files.length,
    totalBytes,
    skipped,
  }
}

function normalizeOptionalRoot(rootPath: string | undefined) {
  if (!rootPath || rootPath === '.') return undefined
  return normalizeVirtualPath(rootPath)
}

function relativeToRoot(path: string, rootPath: string | undefined) {
  const normalized = normalizeVirtualPath(path)
  if (!rootPath) return normalized
  if (normalized === rootPath) return ''
  const prefix = `${rootPath}/`
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : ''
}

function sortGitHubEntries(entries: readonly GitHubTreeEntry[]) {
  return [...entries].sort((left, right) => normalizeVirtualPath(left.path).localeCompare(normalizeVirtualPath(right.path)))
}
