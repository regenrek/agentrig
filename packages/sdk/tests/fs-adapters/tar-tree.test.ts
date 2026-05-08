import { describe, expect, it } from 'vitest'
import { createGitHubTreeVirtualTree, scanRepo } from '../../src'
import { createTarVirtualTree } from '../../src/fs-adapters/tar-tree'

describe('tar fs adapter', () => {
  it('materializes a limited virtual tree from a GitHub-style tar archive', async () => {
    const archive = makeTar({
      'owner-repo-abc123/README.md': '# Repo\n',
      'owner-repo-abc123/skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\n',
      'owner-repo-abc123/node_modules/pkg/index.js': 'ignored',
    })

    const result = await createTarVirtualTree({
      bytes: archive,
      stripFirstDirectory: true,
      includePath: (path) => !path.startsWith('node_modules/'),
    })

    await expect(result.tree.readText('skills/review/SKILL.md')).resolves.toContain('Reviews code')
    await expect(result.tree.readText('node_modules/pkg/index.js')).resolves.toBeNull()
    expect(result.fileCount).toBe(2)
    expect(result.skipped).toContainEqual({ path: 'node_modules/pkg/index.js', reason: 'excluded-path' })
  })

  it('produces the same scan digest as the GitHub blob tree for the same content', async () => {
    const files = {
      'anthropics-skills-main/README.md': '# Anthropic Skills\n',
      'anthropics-skills-main/skills/code-review/SKILL.md':
        '---\nname: code-review\ndescription: Review code changes.\n---\n',
      'anthropics-skills-main/skills/debugging/SKILL.md':
        '---\nname: debugging\ndescription: Debug production failures.\n---\n',
      'anthropics-skills-main/prompts/release.md': '# Release prompt\n',
    }
    const archive = makeTar(files)
    const tarTree = await createTarVirtualTree({ bytes: archive, stripFirstDirectory: true })
    const githubTree = await createGitHubTreeVirtualTree({
      entries: Object.entries(files).map(([path, text]) => ({
        path: path.replace(/^anthropics-skills-main\//, ''),
        type: 'blob' as const,
        sha: `sha-${path}`,
        size: new TextEncoder().encode(text).byteLength,
      })),
      readBlob: async (entry) => new TextEncoder().encode(files[`anthropics-skills-main/${entry.path}` as keyof typeof files]),
    })

    const tarReport = await scanRepo({ source: { type: 'archive', label: 'fixture' }, tree: tarTree.tree })
    const githubReport = await scanRepo({ source: { type: 'github', label: 'fixture' }, tree: githubTree.tree })

    expect(tarReport.digest).toBe(githubReport.digest)
    expect(tarReport.signals).toEqual(githubReport.signals)
  })

  it('rejects unsafe paths and unsupported link entries before scanning', async () => {
    const archive = concatBlocks([
      tarEntry('repo/ok.txt', new TextEncoder().encode('ok')),
      tarEntry('repo/../evil.txt', new TextEncoder().encode('evil')),
      tarEntry('repo/link.txt', new Uint8Array(), '2', 'ok.txt'),
      zeroBlock(),
      zeroBlock(),
    ])

    const result = await createTarVirtualTree({ bytes: archive, stripFirstDirectory: true })

    await expect(result.tree.readText('ok.txt')).resolves.toBe('ok')
    await expect(result.tree.readText('evil.txt')).resolves.toBeNull()
    expect(result.skipped).toContainEqual({ path: 'repo/../evil.txt', reason: 'unsafe-path' })
    expect(result.skipped).toContainEqual({ path: 'link.txt', reason: 'unsupported-entry' })
  })
})

function makeTar(files: Record<string, string>) {
  return concatBlocks([
    ...Object.entries(files).map(([path, text]) => tarEntry(path, new TextEncoder().encode(text))),
    zeroBlock(),
    zeroBlock(),
  ])
}

function tarEntry(path: string, data: Uint8Array, typeflag = '0', linkName = '') {
  const header = new Uint8Array(512)
  writeString(header, 0, 100, path)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, data.byteLength)
  writeOctal(header, 136, 12, 0)
  for (let index = 148; index < 156; index += 1) header[index] = 32
  writeString(header, 156, 1, typeflag)
  writeString(header, 157, 100, linkName)
  writeString(header, 257, 6, 'ustar')
  writeString(header, 263, 2, '00')
  writeOctal(header, 148, 8, checksum(header))
  return concatBlocks([header, data, new Uint8Array(padding(data.byteLength))])
}

function writeString(bytes: Uint8Array, offset: number, length: number, value: string) {
  bytes.set(new TextEncoder().encode(value).subarray(0, length), offset)
}

function writeOctal(bytes: Uint8Array, offset: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, '0')
  writeString(bytes, offset, length, text)
}

function checksum(bytes: Uint8Array) {
  return bytes.reduce((sum, byte) => sum + byte, 0)
}

function padding(size: number) {
  return (512 - (size % 512)) % 512
}

function zeroBlock() {
  return new Uint8Array(512)
}

function concatBlocks(blocks: Uint8Array[]) {
  const total = blocks.reduce((sum, block) => sum + block.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const block of blocks) {
    result.set(block, offset)
    offset += block.byteLength
  }
  return result
}
