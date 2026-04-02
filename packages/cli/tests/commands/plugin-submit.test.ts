import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadAuthSession: vi.fn(),
  getPluginUploadPolicy: vi.fn(),
  getPluginUploadUrl: vi.fn(),
  uploadPluginBundle: vi.fn(),
  createPluginSubmission: vi.fn(),
  getPluginSubmissionStatus: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
  createPluginBundle: vi.fn(),
  removePluginBundle: vi.fn(),
  validatePluginBundle: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: mocks.loadAuthSession,
}))

vi.mock('../../src/lib/community-api', () => ({
  createPluginSubmission: mocks.createPluginSubmission,
  getPluginSubmissionStatus: mocks.getPluginSubmissionStatus,
  getPluginUploadPolicy: mocks.getPluginUploadPolicy,
  getPluginUploadUrl: mocks.getPluginUploadUrl,
  resolveCommunityBaseUrl: mocks.resolveCommunityBaseUrl,
  uploadPluginBundle: mocks.uploadPluginBundle,
}))

vi.mock('../../src/lib/plugin-bundle', () => ({
  createPluginBundle: mocks.createPluginBundle,
  removePluginBundle: mocks.removePluginBundle,
}))

vi.mock('../../src/lib/plugin-submission-validation', () => ({
  validatePluginBundle: mocks.validatePluginBundle,
  PluginSubmissionValidationError: class PluginSubmissionValidationError extends Error {},
  formatPluginValidationMessages: (messages: string[]) => messages.join('\n'),
}))

import command from '../../src/commands/plugin/submit'

describe('command:plugin submit', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.loadAuthSession.mockResolvedValue({
      accessToken: 'token',
      baseUrl: 'https://agentrig.ai',
    })
    mocks.resolveCommunityBaseUrl.mockReturnValue('https://agentrig.ai')
    mocks.getPluginUploadPolicy.mockResolvedValue({
      maxZipBytes: 1,
      maxFileBytes: 1,
      maxTotalBytes: 1,
      maxFiles: 1,
      allowedContentTypes: ['application/zip'],
      blockedExtensions: [],
    })
    mocks.createPluginBundle.mockResolvedValue({
      zipBytes: Uint8Array.from([1, 2, 3]),
      fileName: 'demo.zip',
      bundlePath: '/tmp/demo.zip',
      temporary: true,
    })
    mocks.validatePluginBundle.mockResolvedValue({
      warnings: ['README.md is missing'],
      errors: [],
    })
    mocks.getPluginUploadUrl.mockResolvedValue('https://uploads.example.com')
    mocks.uploadPluginBundle.mockResolvedValue('storage-id')
    mocks.createPluginSubmission.mockResolvedValue('submission-123')
    mocks.getPluginSubmissionStatus.mockResolvedValue({ status: 'pending_review' })
    mocks.removePluginBundle.mockResolvedValue(undefined)
  })

  it('submits a validated plugin bundle and always cleans up the local bundle', async () => {
    await run({
      args: {
        dir: '/repo/demo-plugin',
        baseUrl: undefined,
        'keep-bundle': false,
        help: false,
      },
    })

    expect(mocks.createPluginBundle).toHaveBeenCalledWith({
      dir: '/repo/demo-plugin',
      policy: expect.any(Object),
      temporary: true,
    })
    expect(mocks.createPluginSubmission).toHaveBeenCalledWith(
      'https://agentrig.ai',
      'token',
      {
        storageId: 'storage-id',
        fileName: 'demo.zip',
        fileSize: 3,
        contentType: 'application/zip',
      },
    )
    expect(mocks.removePluginBundle).toHaveBeenCalledWith(
      expect.objectContaining({ bundlePath: '/tmp/demo.zip' }),
    )
  })
})
