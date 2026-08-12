import { describe, expect, it } from 'vite-plus/test'
import { createGitHubTreeVirtualTree, type GitHubTreeEntry } from '../../src'

describe('github tree fs adapter', () => {
  it('materializes a limited virtual tree from GitHub tree entries', async () => {
    const blobs = new Map([
      ['a', new TextEncoder().encode('---\nname: review\ndescription: Reviews code.\n---\nBody\n')],
      ['b', new TextEncoder().encode('ignored')],
    ])
    const entries: GitHubTreeEntry[] = [
      { path: 'repo/skills/review/SKILL.md', type: 'blob', sha: 'a', size: blobs.get('a')!.byteLength },
      { path: 'repo/node_modules/pkg/index.js', type: 'blob', sha: 'b', size: blobs.get('b')!.byteLength },
      { path: 'repo/vendor/submodule', type: 'commit', sha: 'c' },
    ]

    const result = await createGitHubTreeVirtualTree({
      entries,
      rootPath: 'repo',
      readBlob: async (entry) => blobs.get(entry.sha) ?? null,
      includePath: (path) => !path.startsWith('node_modules/'),
    })

    await expect(result.tree.readText('skills/review/SKILL.md')).resolves.toContain('Reviews code')
    await expect(result.tree.readText('node_modules/pkg/index.js')).resolves.toBeNull()
    expect(result.fileCount).toBe(1)
    expect(result.totalBytes).toBe(blobs.get('a')!.byteLength)
    expect(result.skipped).toEqual([
      { path: 'node_modules/pkg/index.js', reason: 'excluded-path' },
      { path: 'vendor/submodule', reason: 'unsupported-entry' },
    ])
  })

  it('skips files after byte limit without fetching them', async () => {
    const fetched: string[] = []
    const result = await createGitHubTreeVirtualTree({
      entries: [
        { path: 'README.md', type: 'blob', sha: 'a', size: 6 },
        { path: 'big.md', type: 'blob', sha: 'b', size: 10 },
      ],
      maxBytes: 8,
      readBlob: async (entry) => {
        fetched.push(entry.path)
        return new TextEncoder().encode('small')
      },
    })

    expect(fetched).toEqual(['README.md'])
    expect(result.skipped).toContainEqual({ path: 'big.md', reason: 'byte-limit' })
  })
})
