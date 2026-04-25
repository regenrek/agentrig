import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { describe, expect, it } from 'vite-plus/test'
import { createZipVirtualTree } from '../../src/fs-adapters/zip-tree'

describe('zip fs adapter', () => {
  it('materializes a limited virtual tree from zip bytes', async () => {
    const zip = await makeZip({
      'repo/README.md': '# Repo\n',
      'repo/skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\n',
      'repo/node_modules/pkg/index.js': 'ignored',
    })

    const result = await createZipVirtualTree({
      bytes: zip,
      rootPath: 'repo',
      includePath: (path) => !path.startsWith('node_modules/'),
    })

    await expect(result.tree.readText('skills/review/SKILL.md')).resolves.toContain('Reviews code')
    await expect(result.tree.readText('node_modules/pkg/index.js')).resolves.toBeNull()
    expect(result.fileCount).toBe(2)
    expect(result.skipped).toContainEqual({ path: 'node_modules/pkg/index.js', reason: 'excluded-path' })
  })

  it('skips zip entries after byte limits', async () => {
    const zip = await makeZip({
      'a.txt': 'abc',
      'b.txt': 'abcdef',
    })

    const result = await createZipVirtualTree({ bytes: zip, maxBytes: 4 })

    expect(result.fileCount).toBe(1)
    expect(result.totalBytes).toBe(3)
    expect(result.skipped).toContainEqual({ path: 'b.txt', reason: 'byte-limit' })
  })
})

async function makeZip(files: Record<string, string>) {
  const writer = new Uint8ArrayWriter()
  const zipWriter = new ZipWriter(writer, { useWebWorkers: false })
  for (const [path, text] of Object.entries(files)) {
    await zipWriter.add(path, new Uint8ArrayReader(new TextEncoder().encode(text)))
  }
  await zipWriter.close()
  return writer.getData()
}
