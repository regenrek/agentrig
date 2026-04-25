import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js'
import { normalizeVirtualPath, type VirtualTree } from '../repo-scan/virtual-tree'
import { createBufferedVirtualTree, type BufferedVirtualFile } from './buffered-tree'

export type ZipVirtualTreeOptions = {
  bytes: Uint8Array
  rootPath?: string
  maxFiles?: number
  maxBytes?: number
  includePath?: (path: string) => boolean
}

export type ZipTreeSkippedEntry = {
  path: string
  reason: 'outside-root' | 'directory' | 'unsafe-path' | 'excluded-path' | 'missing-size' | 'file-limit' | 'byte-limit' | 'read-error'
}

export type ZipVirtualTreeResult = {
  tree: VirtualTree
  fileCount: number
  totalBytes: number
  skipped: ZipTreeSkippedEntry[]
}

const DEFAULT_MAX_FILES = 400
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export async function createZipVirtualTree(options: ZipVirtualTreeOptions): Promise<ZipVirtualTreeResult> {
  const rootPath = normalizeOptionalRoot(options.rootPath)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const skipped: ZipTreeSkippedEntry[] = []
  const files: BufferedVirtualFile[] = []
  let totalBytes = 0
  const reader = new ZipReader(new Uint8ArrayReader(options.bytes), { useWebWorkers: false })

  try {
    const entries = await reader.getEntries()
    for (const entry of sortZipEntries(entries)) {
      if (entry.directory) {
        skipped.push({ path: entry.filename, reason: 'directory' })
        continue
      }
      const relativePath = relativeToRoot(entry.filename, rootPath)
      if (!relativePath) {
        skipped.push({ path: entry.filename, reason: 'outside-root' })
        continue
      }
      if (options.includePath && !options.includePath(relativePath)) {
        skipped.push({ path: relativePath, reason: 'excluded-path' })
        continue
      }
      const size = uncompressedSize(entry)
      if (size == null || size < 0) {
        skipped.push({ path: relativePath, reason: 'missing-size' })
        continue
      }
      if (files.length >= maxFiles) {
        skipped.push({ path: relativePath, reason: 'file-limit' })
        continue
      }
      if (totalBytes + size > maxBytes) {
        skipped.push({ path: relativePath, reason: 'byte-limit' })
        continue
      }
      let bytes
      try {
        bytes = await entry.getData(new Uint8ArrayWriter(), { useWebWorkers: false })
      } catch {
        skipped.push({ path: relativePath, reason: 'read-error' })
        continue
      }
      if (totalBytes + bytes.byteLength > maxBytes) {
        skipped.push({ path: relativePath, reason: 'byte-limit' })
        continue
      }
      files.push({ path: relativePath, bytes })
      totalBytes += bytes.byteLength
    }
  } finally {
    await reader.close().catch(() => {})
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
  let normalized
  try {
    normalized = normalizeVirtualPath(path)
  } catch {
    return ''
  }
  if (!rootPath) return normalized
  if (normalized === rootPath) return ''
  const prefix = `${rootPath}/`
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : ''
}

function uncompressedSize(entry: Entry) {
  return typeof entry.uncompressedSize === 'number' ? entry.uncompressedSize : null
}

function sortZipEntries(entries: readonly Entry[]): FileEntry[] {
  return [...entries]
    .filter((entry): entry is FileEntry => !entry.directory)
    .sort((left, right) => left.filename.localeCompare(right.filename))
}
