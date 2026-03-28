import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js'
import { describe, expect, it } from 'vite-plus/test'
import {
  PackPublishValidationError,
  validatePackBundle,
} from '../../src/lib/pack-publish-validation'
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

type TestZipBuilder = {
  file: (name: string, content: string | Uint8Array) => void
}

async function buildZip(configure: (zip: TestZipBuilder) => void) {
  const files: Array<{ name: string; content: string | Uint8Array }> = []
  configure({
    file(name, content) {
      files.push({ name, content })
    },
  })

  const zipWriter = new ZipWriter(new Uint8ArrayWriter(), {
    level: 9,
    useWebWorkers: false,
  })

  for (const file of files) {
    const reader =
      typeof file.content === 'string'
        ? new TextReader(file.content)
        : new Uint8ArrayReader(file.content)
    await zipWriter.add(file.name, reader)
  }

  return await zipWriter.close()
}

describe('pack publish validation', () => {
  it('validates a correct bundle and returns README warnings when missing', async () => {
    const zipBytes = await buildZip((zip) => {
      zip.file(
        'meta.json',
        JSON.stringify({
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
        })
      )
      zip.file('skills/demo/SKILL.md', '# Skill\n')
    })

    const result = await validatePackBundle(zipBytes, policy)

    expect(result.meta.name).toBe('demo-pack')
    expect(result.warnings).toContain('README.md is missing')
  })

  it('rejects disallowed files and missing meta references', async () => {
    const zipBytes = await buildZip((zip) => {
      zip.file(
        'meta.json',
        JSON.stringify({
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
        })
      )
      zip.file('bin/demo.exe', 'binary-ish')
    })

    await expect(validatePackBundle(zipBytes, policy)).rejects.toMatchObject({
      name: 'PackPublishValidationError',
      errors: expect.arrayContaining([
        'Blocked file type: bin/demo.exe',
        'Missing file referenced in meta.json: skills/demo/SKILL.md',
      ]),
    })
  })
})
