import type { VirtualTree, VirtualTreeEntry } from '../../src/repo-scan/virtual-tree'

export function createMemoryTree(files: Record<string, string>): VirtualTree {
  const normalizedFiles = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace(/\\/g, '/'), text]))
  return {
    async listEntries() {
      const directories = new Set<string>()
      const entries: VirtualTreeEntry[] = []

      for (const [path, text] of Object.entries(normalizedFiles)) {
        collectDirectories(path, directories)
        const bytes = new TextEncoder().encode(text)
        entries.push({
          kind: 'file',
          path,
          bytes: bytes.byteLength,
          sha256: await sha256Hex(bytes),
        })
      }

      return [
        ...[...directories].map((path) => ({ kind: 'directory' as const, path })),
        ...entries,
      ]
    },
    async readText(path: string) {
      return normalizedFiles[path.replace(/\\/g, '/')] ?? null
    },
  }
}

function collectDirectories(path: string, directories: Set<string>) {
  const parts = path.split('/')
  for (let index = 1; index < parts.length; index += 1) {
    directories.add(parts.slice(0, index).join('/'))
  }
}

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
