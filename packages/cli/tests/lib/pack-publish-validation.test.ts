import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
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

async function buildZip(configure: (zip: JSZip) => void) {
  const zip = new JSZip()
  configure(zip)
  return await zip.generateAsync({ type: 'uint8array' })
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
