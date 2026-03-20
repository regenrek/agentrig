import { beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/pack/publish'
import { loadAuthSession } from '../../src/lib/auth'
import {
  createPackSubmission,
  getPackSubmissionStatus,
  getPackUploadPolicy,
  getPackUploadUrl,
  resolveCommunityBaseUrl,
  uploadPackBundle,
} from '../../src/lib/community-api'
import { createPackBundle, removePackBundle } from '../../src/lib/pack-bundle'
import { validatePackBundle } from '../../src/lib/pack-publish-validation'

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: vi.fn(),
}))

vi.mock('../../src/lib/community-api', () => ({
  createPackSubmission: vi.fn(),
  getPackSubmissionStatus: vi.fn(),
  getPackUploadPolicy: vi.fn(),
  getPackUploadUrl: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
  uploadPackBundle: vi.fn(),
}))

vi.mock('../../src/lib/pack-bundle', () => ({
  createPackBundle: vi.fn(),
  removePackBundle: vi.fn(),
}))

vi.mock('../../src/lib/pack-publish-validation', () => ({
  PackPublishValidationError: class PackPublishValidationError extends Error {
    errors: string[]
    warnings: string[]

    constructor(errors: string[], warnings: string[] = []) {
      super(errors[0] ?? 'Pack publish failed validation')
      this.errors = errors
      this.warnings = warnings
    }
  },
  formatPackValidationMessages: (messages: string[]) => messages.map((message) => `- ${message}`).join('\n'),
  validatePackBundle: vi.fn(),
}))

describe('command:pack:publish', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(resolveCommunityBaseUrl).mockReturnValue('https://agentrig.ai')
    vi.mocked(loadAuthSession).mockResolvedValue({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'token-1',
      expiresAt: 123,
      userId: 'user-1',
    })
    vi.mocked(getPackUploadPolicy).mockResolvedValue({
      maxZipBytes: 1,
      maxFileBytes: 2,
      maxTotalBytes: 3,
      maxFiles: 4,
      allowedContentTypes: ['application/zip'],
      blockedExtensions: ['.exe'],
      allowedFileExtensions: ['.md'],
      allowedFilenames: ['README.md'],
      allowedTargetPrefixes: ['.codex/'],
      publishedVersionRetention: 10,
    })
    vi.mocked(createPackBundle).mockResolvedValue({
      directory: '/repo',
      bundlePath: '/tmp/demo-pack-1.2.3.zip',
      fileName: 'demo-pack-1.2.3.zip',
      meta: {
        name: 'demo-pack',
        title: 'Demo Pack',
        description: 'Example pack',
        version: '1.2.3',
        files: [],
      },
      zipBytes: new Uint8Array([1, 2, 3]),
      temporary: true,
    })
    vi.mocked(validatePackBundle).mockResolvedValue({
      meta: {
        name: 'demo-pack',
        title: 'Demo Pack',
        description: 'Example pack',
        version: '1.2.3',
        files: [],
      },
      fileCount: 2,
      totalBytes: 32,
      zipBytes: 128,
      warnings: ['README.md is missing'],
    })
    vi.mocked(getPackUploadUrl).mockResolvedValue('https://upload.example.com')
    vi.mocked(uploadPackBundle).mockResolvedValue('storage-1')
    vi.mocked(createPackSubmission).mockResolvedValue('submission-1')
    vi.mocked(getPackSubmissionStatus).mockResolvedValue({
      _id: 'submission-1',
      fileName: 'demo-pack-1.2.3.zip',
      status: 'pending_scan',
      scanStatus: 'pending',
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('publishes a validated bundle and prints the submission id', async () => {
    await run({ args: { dir: '/repo', help: false, 'keep-bundle': false } })

    expect(uploadPackBundle).toHaveBeenCalledWith(
      'https://upload.example.com',
      new Uint8Array([1, 2, 3])
    )
    expect(createPackSubmission).toHaveBeenCalledWith(
      'https://agentrig.ai',
      'token-1',
      expect.objectContaining({
        storageId: 'storage-1',
        fileName: 'demo-pack-1.2.3.zip',
      })
    )
    expect(console.log).toHaveBeenCalledWith('Submission: submission-1')
    expect(console.log).toHaveBeenCalledWith('submitted, waiting for review')
    expect(removePackBundle).toHaveBeenCalled()
  })

  it('keeps the bundle when requested', async () => {
    await run({ args: { dir: '/repo', help: false, 'keep-bundle': true } })
    expect(console.log).toHaveBeenCalledWith('Bundle kept at: /tmp/demo-pack-1.2.3.zip')
  })
})
