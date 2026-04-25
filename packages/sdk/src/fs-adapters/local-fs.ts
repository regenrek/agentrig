import { promises as fs } from 'node:fs'
import path from 'node:path'
import { normalizeVirtualPath, type VirtualTreeEntry } from '../repo-scan/virtual-tree'
import { createBufferedVirtualTree, sha256Hex, type BufferedVirtualFile } from './buffered-tree'

export type LocalFsVirtualTreeOptions = {
  root: string
  skipDirNames?: readonly string[]
  maxFiles?: number
  maxBytes?: number
}

export type LocalFsSkippedEntry = {
  path: string
  reason: 'excluded-path' | 'file-limit' | 'byte-limit' | 'read-error' | 'unsupported-entry'
}

export type LocalFsVirtualTreeResult = {
  tree: Awaited<ReturnType<typeof createBufferedVirtualTree>>
  fileCount: number
  totalBytes: number
  skipped: LocalFsSkippedEntry[]
}

const DEFAULT_SKIP_DIRS = ['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'vendor'] as const
const DEFAULT_MAX_FILES = 400
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export async function createLimitedLocalFsVirtualTree(options: LocalFsVirtualTreeOptions): Promise<LocalFsVirtualTreeResult> {
  const root = path.resolve(options.root)
  const skipDirNames = new Set(options.skipDirNames ?? DEFAULT_SKIP_DIRS)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const skipped: LocalFsSkippedEntry[] = []
  const files: BufferedVirtualFile[] = []
  let totalBytes = 0

  await collectLimitedFiles(root, root, files, skipped, {
    skipDirNames,
    maxFiles,
    maxBytes,
    totalBytesRef: () => totalBytes,
    addBytes: (bytes) => {
      totalBytes += bytes
    },
  })

  return {
    tree: await createBufferedVirtualTree(files),
    fileCount: files.length,
    totalBytes,
    skipped,
  }
}

export function createLocalFsVirtualTree(
  root: string,
  options: {
    skipDirNames?: ReadonlySet<string>
    includePath?: (relativePath: string, absolutePath: string) => boolean | Promise<boolean>
  } = {}
) {
  const resolvedRoot = path.resolve(root)
  const skipDirNames = options.skipDirNames ?? new Set(DEFAULT_SKIP_DIRS)
  return {
    async listEntries() {
      const entries: VirtualTreeEntry[] = []
      await walk(resolvedRoot, resolvedRoot, entries, { ...options, skipDirNames })
      return entries.sort((left, right) => left.path.localeCompare(right.path))
    },
    async readText(relativePath: string) {
      const filePath = resolveSafe(resolvedRoot, relativePath)
      try {
        return await fs.readFile(filePath, 'utf-8')
      } catch {
        return null
      }
    },
    async readBytes(relativePath: string) {
      const filePath = resolveSafe(resolvedRoot, relativePath)
      try {
        return await fs.readFile(filePath)
      } catch {
        return null
      }
    },
  }
}

async function walk(
  root: string,
  currentDir: string,
  entries: VirtualTreeEntry[],
  options: {
    skipDirNames?: ReadonlySet<string>
    includePath?: (relativePath: string, absolutePath: string) => boolean | Promise<boolean>
  }
) {
  const dirents = await fs.readdir(currentDir, { withFileTypes: true })
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory() && options.skipDirNames?.has(dirent.name)) continue

    const absolutePath = path.join(currentDir, dirent.name)
    const relativePath = normalizeVirtualPath(path.relative(root, absolutePath).split(path.sep).join('/'))
    if (dirent.isDirectory()) {
      entries.push({ kind: 'directory', path: relativePath })
      await walk(root, absolutePath, entries, options)
      continue
    }
    if (!dirent.isFile()) continue
    if (options.includePath && !await options.includePath(relativePath, absolutePath)) continue

    const bytes = await fs.readFile(absolutePath)
    entries.push({
      kind: 'file',
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    })
  }
}

function resolveSafe(root: string, relativePath: string) {
  const normalized = normalizeVirtualPath(relativePath)
  const resolved = path.resolve(root, normalized)
  const resolvedRoot = path.resolve(root)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes source root: ${relativePath}`)
  }
  return resolved
}

async function collectLimitedFiles(
  root: string,
  currentDir: string,
  files: BufferedVirtualFile[],
  skipped: LocalFsSkippedEntry[],
  options: {
    skipDirNames: ReadonlySet<string>
    maxFiles: number
    maxBytes: number
    totalBytesRef(): number
    addBytes(bytes: number): void
  }
) {
  const dirents = await fs.readdir(currentDir, { withFileTypes: true })
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory() && options.skipDirNames.has(dirent.name)) continue

    const absolutePath = path.join(currentDir, dirent.name)
    const relativePath = normalizeVirtualPath(path.relative(root, absolutePath).split(path.sep).join('/'))
    if (dirent.isDirectory()) {
      await collectLimitedFiles(root, absolutePath, files, skipped, options)
      continue
    }
    if (!dirent.isFile()) {
      skipped.push({ path: relativePath, reason: 'unsupported-entry' })
      continue
    }
    if (files.length >= options.maxFiles) {
      skipped.push({ path: relativePath, reason: 'file-limit' })
      continue
    }

    let bytes
    try {
      bytes = await fs.readFile(absolutePath)
    } catch {
      skipped.push({ path: relativePath, reason: 'read-error' })
      continue
    }
    if (options.totalBytesRef() + bytes.byteLength > options.maxBytes) {
      skipped.push({ path: relativePath, reason: 'byte-limit' })
      continue
    }
    files.push({ path: relativePath, bytes })
    options.addBytes(bytes.byteLength)
  }
}
