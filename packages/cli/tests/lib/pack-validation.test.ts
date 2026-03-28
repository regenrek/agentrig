import { describe, expect, it } from 'vite-plus/test'
import {
  isAllowedExtension,
  isAllowedFilename,
  isAllowedTarget,
  isBlockedExtension,
  isSafeRelativePath,
  validatePackMeta,
} from '../../src/lib/pack-validation'
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

describe('pack validation', () => {
  it('accepts valid meta and normalizes optional fields', () => {
    const result = validatePackMeta(
      {
        name: 'demo-pack',
        title: 'Demo Pack',
        description: 'Example pack',
        version: '1.2.3',
        topics: { stack: ['ts', 'ai'] },
        files: [
          {
            path: 'skills/demo/SKILL.md',
            target: '.codex/skills/demo/SKILL.md',
          },
        ],
      },
      policy
    )

    expect(result.topics).toEqual({ stack: ['ts', 'ai'] })
    expect(result.files).toHaveLength(1)
  })

  it('rejects invalid target prefixes', () => {
    expect(() =>
      validatePackMeta(
        {
          name: 'demo-pack',
          title: 'Demo Pack',
          description: 'Example pack',
          version: '1.2.3',
          files: [
            {
              path: 'skills/demo/SKILL.md',
              target: 'bin/demo',
            },
          ],
        },
        policy
      )
    ).toThrow('Invalid target for file path: skills/demo/SKILL.md')
  })

  it('matches extension, filename, target, blocked-extension, and path rules', () => {
    expect(isAllowedExtension('skills/demo/SKILL.md', policy)).toBe(true)
    expect(isAllowedFilename('README.md', policy)).toBe(true)
    expect(isAllowedTarget('.codex/skills/demo/SKILL.md', policy)).toBe(true)
    expect(isBlockedExtension('bin/demo.exe', policy)).toBe(true)
    expect(isSafeRelativePath('../secret')).toBe(false)
  })
})
