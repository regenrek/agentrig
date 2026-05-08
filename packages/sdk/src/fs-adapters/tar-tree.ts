import { normalizeVirtualPath, type VirtualTree } from '../repo-scan/virtual-tree'
import { createBufferedVirtualTree, type BufferedVirtualFile } from './buffered-tree'

export type TarVirtualTreeOptions = {
  bytes: Uint8Array
  rootPath?: string
  stripFirstDirectory?: boolean
  maxFiles?: number
  maxBytes?: number
  includePath?: (path: string) => boolean
}

export type TarTreeSkippedEntry = {
  path: string
  reason:
    | 'outside-root'
    | 'directory'
    | 'unsafe-path'
    | 'excluded-path'
    | 'unsupported-entry'
    | 'file-limit'
    | 'byte-limit'
}

export type TarVirtualTreeResult = {
  tree: VirtualTree
  fileCount: number
  totalBytes: number
  skipped: TarTreeSkippedEntry[]
}

const BLOCK_SIZE = 512
const DEFAULT_MAX_FILES = 400
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const textDecoder = new TextDecoder('utf-8')

export async function createTarVirtualTree(options: TarVirtualTreeOptions): Promise<TarVirtualTreeResult> {
  const rootPath = normalizeOptionalRoot(options.rootPath)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const skipped: TarTreeSkippedEntry[] = []
  const files: BufferedVirtualFile[] = []
  let totalBytes = 0
  let offset = 0
  let nextLongPath: string | undefined
  let nextPaxPath: string | undefined

  while (offset + BLOCK_SIZE <= options.bytes.byteLength) {
    const header = options.bytes.subarray(offset, offset + BLOCK_SIZE)
    if (isZeroBlock(header)) break
    if (!hasValidChecksum(header)) throw new Error('Invalid tar archive header checksum.')

    const typeflag = readString(header, 156, 1) || '0'
    const size = readOctal(header, 124, 12)
    if (size < 0 || offset + BLOCK_SIZE + size > options.bytes.byteLength) {
      throw new Error('Invalid tar archive entry size.')
    }
    const dataStart = offset + BLOCK_SIZE
    const dataEnd = dataStart + size
    const data = options.bytes.subarray(dataStart, dataEnd)
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE

    if (typeflag === 'x') {
      nextPaxPath = parsePaxPath(data) ?? nextPaxPath
      continue
    }
    if (typeflag === 'L') {
      nextLongPath = stripNullTerminator(textDecoder.decode(data))
      continue
    }

    const rawPath = nextPaxPath ?? nextLongPath ?? readTarPath(header)
    nextLongPath = undefined
    nextPaxPath = undefined
    const relativePath = relativeToRoot(rawPath, rootPath, Boolean(options.stripFirstDirectory))

    if (!relativePath) {
      skipped.push({ path: rawPath, reason: 'outside-root' })
      continue
    }
    if (relativePath === '.unsafe') {
      skipped.push({ path: rawPath, reason: 'unsafe-path' })
      continue
    }
    if (typeflag === '5') {
      skipped.push({ path: relativePath, reason: 'directory' })
      continue
    }
    if (typeflag !== '0' && typeflag !== '\0') {
      skipped.push({ path: relativePath, reason: 'unsupported-entry' })
      continue
    }
    if (options.includePath && !options.includePath(relativePath)) {
      skipped.push({ path: relativePath, reason: 'excluded-path' })
      continue
    }
    if (files.length >= maxFiles) {
      skipped.push({ path: relativePath, reason: 'file-limit' })
      continue
    }
    if (totalBytes + data.byteLength > maxBytes) {
      skipped.push({ path: relativePath, reason: 'byte-limit' })
      continue
    }
    files.push({ path: relativePath, bytes: data.slice() })
    totalBytes += data.byteLength
  }

  return {
    tree: await createBufferedVirtualTree(files.sort((left, right) => left.path.localeCompare(right.path))),
    fileCount: files.length,
    totalBytes,
    skipped,
  }
}

function normalizeOptionalRoot(rootPath: string | undefined) {
  if (!rootPath || rootPath === '.') return undefined
  return normalizeVirtualPath(rootPath)
}

function relativeToRoot(path: string, rootPath: string | undefined, stripFirstDirectory: boolean) {
  let normalized
  try {
    normalized = normalizeVirtualPath(path)
  } catch {
    return '.unsafe'
  }
  if (stripFirstDirectory) {
    const slashIndex = normalized.indexOf('/')
    normalized = slashIndex === -1 ? '' : normalized.slice(slashIndex + 1)
  }
  if (!normalized) return ''
  if (!rootPath) return normalized
  if (normalized === rootPath) return ''
  const prefix = `${rootPath}/`
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : ''
}

function readTarPath(header: Uint8Array) {
  const name = readString(header, 0, 100)
  const prefix = readString(header, 345, 155)
  return prefix ? `${prefix}/${name}` : name
}

function readString(bytes: Uint8Array, offset: number, length: number) {
  const chunk = bytes.subarray(offset, offset + length)
  const nullIndex = chunk.indexOf(0)
  return textDecoder.decode(nullIndex === -1 ? chunk : chunk.subarray(0, nullIndex)).trim()
}

function readOctal(bytes: Uint8Array, offset: number, length: number) {
  const raw = readString(bytes, offset, length).replace(/\0/g, '').trim()
  if (!raw) return 0
  const value = Number.parseInt(raw, 8)
  return Number.isFinite(value) ? value : -1
}

function isZeroBlock(block: Uint8Array) {
  return block.every((byte) => byte === 0)
}

function hasValidChecksum(header: Uint8Array) {
  const expected = readOctal(header, 148, 8)
  if (expected < 0) return false
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index]
  }
  return actual === expected
}

function parsePaxPath(data: Uint8Array) {
  const text = textDecoder.decode(data)
  let offset = 0
  while (offset < text.length) {
    const spaceIndex = text.indexOf(' ', offset)
    if (spaceIndex === -1) break
    const length = Number.parseInt(text.slice(offset, spaceIndex), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = text.slice(spaceIndex + 1, offset + length - 1)
    const equalsIndex = record.indexOf('=')
    if (equalsIndex > 0 && record.slice(0, equalsIndex) === 'path') {
      return record.slice(equalsIndex + 1)
    }
    offset += length
  }
  return undefined
}

function stripNullTerminator(value: string) {
  const index = value.indexOf('\0')
  return index === -1 ? value : value.slice(0, index)
}
