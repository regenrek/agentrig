import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/pack/bundle'
import { loadAuthSession } from '../../src/lib/auth'
import { getPackUploadPolicy, resolveCommunityBaseUrl } from '../../src/lib/community-api'
import { createPackBundle } from '../../src/lib/pack-bundle'
import { PackPublishValidationError, validatePackBundle } from '../../src/lib/pack-publish-validation'

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: vi.fn(),
}))

vi.mock('../../src/lib/community-api', () => ({
  getPackUploadPolicy: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
}))

vi.mock('../../src/lib/pack-bundle', () => ({
  createPackBundle: vi.fn(),
}))

vi.mock('../../src/lib/pack-publish-validation', () => ({
  PackPublishValidationError: class PackPublishValidationError extends Error {
    errors: string[]
    warnings: string[]

    constructor(errors: string[], warnings: string[] = []) {
      super(errors[0] ?? 'Pack bundle validation failed')
      this.errors = errors
      this.warnings = warnings
    }
  },
  formatPackValidationMessages: (messages: string[]) => messages.map((message) => `- ${message}`).join('\n'),
  validatePackBundle: vi.fn(),
}))

describe('command:pack:bundle', () => {
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
      bundlePath: '/repo/demo-pack-1.2.3.zip',
      fileName: 'demo-pack-1.2.3.zip',
      meta: {
        name: 'demo-pack',
        title: 'Demo Pack',
        description: 'Example pack',
        version: '1.2.3',
        files: [],
      },
      zipBytes: new Uint8Array([1, 2, 3]),
      temporary: false,
    })
  })

  it('builds and validates a pack bundle', async () => {
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

    await run({
      args: {
        dir: '/repo',
        out: undefined,
        help: false,
      },
    })

    expect(getPackUploadPolicy).toHaveBeenCalledWith('https://agentrig.ai', 'token-1')
    expect(createPackBundle).toHaveBeenCalledWith({
      dir: '/repo',
      policy: expect.any(Object),
      outFile: undefined,
      temporary: false,
    })
    expect(console.log).toHaveBeenCalledWith('Warnings:')
    expect(console.log).toHaveBeenCalledWith('Bundle ready: /repo/demo-pack-1.2.3.zip')
  })

  it('fails when not logged in', async () => {
    vi.mocked(loadAuthSession).mockResolvedValue(null)

    await expect(run({ args: { help: false } })).rejects.toThrow(
      'Not logged in. Run `agentrig login` first so the CLI can fetch the hosted upload policy.'
    )
  })

  it('formats validation failures', async () => {
    vi.mocked(validatePackBundle).mockRejectedValue(
      new PackPublishValidationError(['Blocked file type: bad.exe'], ['README.md is missing'])
    )

    await expect(run({ args: { dir: '/repo', help: false } })).rejects.toThrow(
      'Pack bundle failed validation:\n- Blocked file type: bad.exe\nWarnings:\n- README.md is missing'
    )
  })
})
