import { normalizeVirtualPath, type VirtualTree, type VirtualTreeEntry } from '../repo-scan/virtual-tree'

export type BufferedVirtualFile = {
  path: string
  bytes: Uint8Array
  sha256?: string
}

export async function createBufferedVirtualTree(files: readonly BufferedVirtualFile[]): Promise<VirtualTree> {
  const normalizedFiles = await Promise.all(
    files.map(async (file) => ({
      path: normalizeVirtualPath(file.path),
      bytes: file.bytes,
      sha256: file.sha256 ?? await sha256Hex(file.bytes),
    }))
  )
  const byPath = new Map(normalizedFiles.map((file) => [file.path, file]))
  const entries = buildEntries(normalizedFiles)

  return {
    async listEntries() {
      return entries
    },
    async readText(path) {
      const file = byPath.get(normalizeVirtualPath(path))
      if (!file) return null
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
      } catch {
        return null
      }
    },
    async readBytes(path) {
      return byPath.get(normalizeVirtualPath(path))?.bytes ?? null
    },
  }
}

export async function sha256Hex(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function buildEntries(files: readonly Required<BufferedVirtualFile>[]): VirtualTreeEntry[] {
  const directories = new Set<string>()
  for (const file of files) {
    const parts = file.path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }
  return [
    ...[...directories].map((path) => ({ path, kind: 'directory' as const })),
    ...files.map((file) => ({
      path: file.path,
      kind: 'file' as const,
      bytes: file.bytes.byteLength,
      sha256: file.sha256,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path))
}
