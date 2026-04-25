import { describe, expect, it } from 'vite-plus/test'
import {
  assertSafeVirtualPath,
  isSafeVirtualPath,
  joinVirtualPath,
  listVirtualFiles,
  normalizeVirtualPath,
  virtualBasename,
  virtualDirname,
  virtualExtname,
  type VirtualTree,
} from '../../src/repo-scan/virtual-tree'

describe('virtual tree paths', () => {
  it('normalizes paths to repo-relative POSIX form', () => {
    expect(normalizeVirtualPath('./skills\\foo//SKILL.md')).toBe('skills/foo/SKILL.md')
    expect(joinVirtualPath('skills', 'foo', 'SKILL.md')).toBe('skills/foo/SKILL.md')
    expect(virtualBasename('skills/foo/SKILL.md')).toBe('SKILL.md')
    expect(virtualDirname('skills/foo/SKILL.md')).toBe('skills/foo')
    expect(virtualExtname('skills/foo/SKILL.md')).toBe('.md')
  })

  it('rejects paths that escape the virtual tree', () => {
    expect(isSafeVirtualPath('skills/foo.md')).toBe(true)
    expect(isSafeVirtualPath('../secret')).toBe(false)
    expect(isSafeVirtualPath('/abs/path')).toBe(false)
    expect(isSafeVirtualPath('C:\\Users\\secret')).toBe(false)
    expect(isSafeVirtualPath('skills/ ../secret')).toBe(false)
    expect(isSafeVirtualPath('skills/ foo.md')).toBe(false)
    expect(isSafeVirtualPath(' ')).toBe(false)
    expect(() => assertSafeVirtualPath('../secret')).toThrow(/unsafe virtual path/i)
  })

  it('lists only files in stable path order', async () => {
    const tree: VirtualTree = {
      async listEntries() {
        return [
          { kind: 'directory', path: 'skills' },
          { kind: 'file', path: 'z.md', bytes: 1, sha256: 'z' },
          { kind: 'file', path: 'a.md', bytes: 1, sha256: 'a' },
        ]
      },
      async readText() {
        return null
      },
    }

    await expect(listVirtualFiles(tree)).resolves.toEqual([
      { kind: 'file', path: 'a.md', bytes: 1, sha256: 'a' },
      { kind: 'file', path: 'z.md', bytes: 1, sha256: 'z' },
    ])
  })
})
