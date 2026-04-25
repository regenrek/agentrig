import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VirtualTree, VirtualTreeEntry } from '../../src/repo-scan/virtual-tree'

const fixturesRoot = fileURLToPath(new URL('.', import.meta.url))

export function fixturePath(name: string) {
  return path.join(fixturesRoot, name)
}

export function createFixtureTree(name: string): VirtualTree {
  const root = fixturePath(name)
  return {
    async listEntries() {
      const entries: VirtualTreeEntry[] = []
      await collectEntries(root, root, entries)
      return entries.sort((left, right) => left.path.localeCompare(right.path))
    },
    async readText(filePath: string) {
      try {
        return await fs.readFile(path.join(root, filePath.replace(/\\/g, '/')), 'utf-8')
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async readBytes(filePath: string) {
      try {
        return await fs.readFile(path.join(root, filePath.replace(/\\/g, '/')))
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
  }
}

async function collectEntries(root: string, current: string, entries: VirtualTreeEntry[]) {
  const dirEntries = await fs.readdir(current, { withFileTypes: true })
  for (const dirEntry of dirEntries) {
    const absolutePath = path.join(current, dirEntry.name)
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/')
    if (dirEntry.isDirectory()) {
      entries.push({ kind: 'directory', path: relativePath })
      await collectEntries(root, absolutePath, entries)
      continue
    }
    if (!dirEntry.isFile()) continue
    const bytes = await fs.readFile(absolutePath)
    entries.push({
      kind: 'file',
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    })
  }
}

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isNotFound(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

