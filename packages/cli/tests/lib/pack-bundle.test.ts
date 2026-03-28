import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Uint8ArrayReader, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createPackBundle, removePackBundle } from '../../src/lib/pack-bundle'
import type { PackUploadPolicySnapshot } from '../../src/lib/types'

const policy: PackUploadPolicySnapshot = {
  maxZipBytes: 25 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFiles: 500,
  allowedContentTypes: ['application/zip'],
  blockedExtensions: ['.exe', '.dll'],
  allowedFileExtensions: ['.md', '.json', '.ts', '.sh'],
  allowedFilenames: ['README.md', 'Dockerfile'],
  allowedTargetPrefixes: ['.codex/', '.agentrig/', 'scripts/'],
  publishedVersionRetention: 10,
}

describe('pack bundle', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('creates a publishable zip with meta and readme at the root', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-pack-bundle-'))
    await fs.mkdir(path.join(tempDir, 'skills', 'demo'), { recursive: true })
    await fs.writeFile(
      path.join(tempDir, 'meta.json'),
      JSON.stringify(
        {
          name: 'demo-pack',
          title: 'Demo Pack',
          description: 'Example pack',
          version: '1.2.3',
          files: [
            {
              path: 'skills/demo/SKILL.md',
              target: '.codex/skills/demo/SKILL.md',
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Demo\n', 'utf-8')
    await fs.writeFile(path.join(tempDir, 'skills', 'demo', 'SKILL.md'), 'skill body', 'utf-8')

    const bundle = await createPackBundle({ dir: tempDir, policy })

    expect(bundle.fileName).toBe('demo-pack-1.2.3.zip')
    const zipReader = new ZipReader(new Uint8ArrayReader(bundle.zipBytes), {
      useWebWorkers: false,
    })
    const entries = (await zipReader.getEntries()).filter(
      (entry): entry is FileEntry => !entry.directory
    )
    const filenames = entries.map((entry) => entry.filename)
    expect(filenames).toContain('meta.json')
    expect(filenames).toContain('README.md')
    expect(filenames).toContain('skills/demo/SKILL.md')
    await zipReader.close()

    await removePackBundle(bundle)
    await expect(fs.access(bundle.bundlePath)).rejects.toThrow()
  })

  it('rejects symlinked publish files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-pack-bundle-'))
    await fs.mkdir(path.join(tempDir, 'skills', 'demo'), { recursive: true })
    await fs.writeFile(
      path.join(tempDir, 'meta.json'),
      JSON.stringify(
        {
          name: 'demo-pack',
          title: 'Demo Pack',
          description: 'Example pack',
          version: '1.2.3',
          files: [
            {
              path: 'skills/demo/SKILL.md',
              target: '.codex/skills/demo/SKILL.md',
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    )

    const outside = path.join(tempDir, '..', `outside-${Date.now()}.txt`)
    await fs.writeFile(outside, 'secret', 'utf-8')
    await fs.symlink(outside, path.join(tempDir, 'skills', 'demo', 'SKILL.md'))

    await expect(createPackBundle({ dir: tempDir, policy })).rejects.toThrow(
      'Symlinks are not allowed in publish bundles'
    )

    await fs.rm(outside, { force: true })
  })

  it('rejects symlinked directories in publish paths', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-pack-bundle-'))
    await fs.writeFile(
      path.join(tempDir, 'meta.json'),
      JSON.stringify(
        {
          name: 'demo-pack',
          title: 'Demo Pack',
          description: 'Example pack',
          version: '1.2.3',
          files: [
            {
              path: 'skills/demo/SKILL.md',
              target: '.codex/skills/demo/SKILL.md',
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    )

    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-pack-bundle-outside-'))
    await fs.mkdir(path.join(outsideDir, 'demo'), { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'demo', 'SKILL.md'), 'secret', 'utf-8')
    await fs.symlink(outsideDir, path.join(tempDir, 'skills'))

    await expect(createPackBundle({ dir: tempDir, policy })).rejects.toThrow(
      'Symlinks are not allowed in publish bundles: skills/demo/SKILL.md'
    )

    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  it('rejects symlinked README.md files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-pack-bundle-'))
    await fs.mkdir(path.join(tempDir, 'skills', 'demo'), { recursive: true })
    await fs.writeFile(
      path.join(tempDir, 'meta.json'),
      JSON.stringify(
        {
          name: 'demo-pack',
          title: 'Demo Pack',
          description: 'Example pack',
          version: '1.2.3',
          files: [
            {
              path: 'skills/demo/SKILL.md',
              target: '.codex/skills/demo/SKILL.md',
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    )
    await fs.writeFile(path.join(tempDir, 'skills', 'demo', 'SKILL.md'), 'skill body', 'utf-8')

    const outside = path.join(tempDir, '..', `readme-${Date.now()}.md`)
    await fs.writeFile(outside, '# secret\n', 'utf-8')
    await fs.symlink(outside, path.join(tempDir, 'README.md'))

    await expect(createPackBundle({ dir: tempDir, policy })).rejects.toThrow(
      'Symlinks are not allowed in publish bundles: README.md'
    )

    await fs.rm(outside, { force: true })
  })
})
