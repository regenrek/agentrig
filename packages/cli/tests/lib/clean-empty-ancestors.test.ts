import { afterEach, describe, expect, it } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanEmptyAncestors } from '../../src/lib/plugin-providers/shared'

const tempDirs: string[] = []

describe('cleanEmptyAncestors', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('removes empty directories upward and deletes residual .DS_Store files', async () => {
    const root = await tempRoot()
    const ancestor = path.join(root, 'plugins')
    const inner = path.join(ancestor, 'agentrig-regenrek-agent-skills', 'skills')
    await fs.mkdir(inner, { recursive: true })
    await fs.writeFile(path.join(inner, '.DS_Store'), Buffer.alloc(0))
    await fs.writeFile(path.join(path.dirname(inner), '.DS_Store'), Buffer.alloc(0))

    await cleanEmptyAncestors(inner, ancestor, false)

    await expect(fs.access(inner)).rejects.toThrow()
    await expect(fs.access(path.dirname(inner))).rejects.toThrow()
    await expect(fs.access(ancestor)).rejects.toThrow()
  })

  it('stops at the first non-empty ancestor', async () => {
    const root = await tempRoot()
    const ancestor = path.join(root, 'plugins')
    const sibling = path.join(ancestor, 'keep-me', 'README.md')
    const inner = path.join(ancestor, 'remove-me', 'skills')
    await fs.mkdir(path.dirname(sibling), { recursive: true })
    await fs.writeFile(sibling, 'kept')
    await fs.mkdir(inner, { recursive: true })

    await cleanEmptyAncestors(inner, ancestor, false)

    await expect(fs.access(inner)).rejects.toThrow()
    await expect(fs.access(path.dirname(inner))).rejects.toThrow()
    await expect(fs.access(ancestor)).resolves.toBeUndefined()
    await expect(fs.access(sibling)).resolves.toBeUndefined()
  })

  it('respects dryRun and does not modify the filesystem', async () => {
    const root = await tempRoot()
    const ancestor = path.join(root, 'plugins')
    const inner = path.join(ancestor, 'leaf')
    await fs.mkdir(inner, { recursive: true })
    await fs.writeFile(path.join(inner, '.DS_Store'), Buffer.alloc(0))

    await cleanEmptyAncestors(inner, ancestor, true)

    await expect(fs.access(inner)).resolves.toBeUndefined()
    await expect(fs.access(path.join(inner, '.DS_Store'))).resolves.toBeUndefined()
  })

  it('refuses to walk above the ancestorRoot', async () => {
    const root = await tempRoot()
    const ancestor = path.join(root, 'plugins')
    await fs.mkdir(ancestor, { recursive: true })
    await fs.writeFile(path.join(root, 'unrelated.txt'), 'hi')

    await cleanEmptyAncestors(path.join(ancestor, 'leaf'), ancestor, false)

    await expect(fs.access(path.join(root, 'unrelated.txt'))).resolves.toBeUndefined()
  })

  it('does not treat sibling prefix paths as contained in the ancestorRoot', async () => {
    const root = await tempRoot()
    const ancestor = path.join(root, 'plugins')
    const siblingPrefix = path.join(root, 'plugins2', 'leaf')
    await fs.mkdir(siblingPrefix, { recursive: true })
    await fs.writeFile(path.join(siblingPrefix, '.DS_Store'), Buffer.alloc(0))

    await cleanEmptyAncestors(siblingPrefix, ancestor, false)

    await expect(fs.access(siblingPrefix)).resolves.toBeUndefined()
    await expect(fs.access(path.join(siblingPrefix, '.DS_Store'))).resolves.toBeUndefined()
  })
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-clean-empty-'))
  tempDirs.push(dir)
  return dir
}
