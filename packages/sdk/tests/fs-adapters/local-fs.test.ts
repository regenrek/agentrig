import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { detectPluginFeatures } from '../../src'
import { createLimitedLocalFsVirtualTree, createLocalFsVirtualTree } from '../../src/fs-adapters/local-fs'

describe('local fs adapter', () => {
  it('exposes local files as a deterministic virtual tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agentrig-sdk-local-'))
    await mkdir(path.join(root, 'skills', 'review'), { recursive: true })
    await mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true })
    await writeFile(path.join(root, 'README.md'), '# Repo\n')
    await writeFile(path.join(root, 'skills', 'review', 'SKILL.md'), '---\nname: Review\ndescription: Reviews code.\n---\n')
    await writeFile(path.join(root, 'node_modules', 'ignored', 'index.js'), 'ignored')

    const tree = createLocalFsVirtualTree(root)

    await expect(tree.readText('skills/review/SKILL.md')).resolves.toContain('Reviews code')
    expect((await tree.listEntries()).map((entry) => entry.path)).toEqual([
      'README.md',
      'skills',
      'skills/review',
      'skills/review/SKILL.md',
    ])
    await expect(detectPluginFeatures(tree)).resolves.toMatchObject({
      hasReadme: true,
      hasSkills: true,
    })
  })

  it('applies file and byte limits before buffering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agentrig-sdk-local-limit-'))
    await writeFile(path.join(root, 'a.txt'), 'abc')
    await writeFile(path.join(root, 'b.txt'), 'abcdef')

    const result = await createLimitedLocalFsVirtualTree({ root, maxBytes: 4 })

    expect(result.fileCount).toBe(1)
    expect(result.totalBytes).toBe(3)
    expect(result.skipped).toContainEqual({ path: 'b.txt', reason: 'byte-limit' })
  })
})
