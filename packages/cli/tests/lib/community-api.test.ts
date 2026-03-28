import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  CommunityApiError,
  createPackSubmission,
  exchangeCliLogin,
  getPackSubmissionStatus,
  getPackUploadPolicy,
  getPackUploadUrl,
  listPackSubmissions,
  logout,
  resolveCommunityBaseUrl,
  startCliLogin,
  uploadPackBundle,
  whoAmI,
} from '../../src/lib/community-api'

describe('community api', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it('resolves base url from explicit input, env, stored value, and default', () => {
    vi.stubEnv('AGENTRIG_BASE_URL', 'http://localhost:5173/')
    expect(resolveCommunityBaseUrl('https://custom.example/')).toBe('https://custom.example')
    expect(resolveCommunityBaseUrl(undefined, 'https://stored.example')).toBe('http://localhost:5173')
    vi.unstubAllEnvs()
    expect(resolveCommunityBaseUrl(undefined, 'https://stored.example/')).toBe('https://stored.example')
    expect(resolveCommunityBaseUrl()).toBe('https://agentrig.ai')
  })

  it('starts cli login', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'request-1',
          publicCode: 'ABCD-1234',
          exchangeSecret: 'secret',
          expiresAt: 123,
          verificationUrl: 'https://agentrig.ai/cli/auth/request-1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    await expect(startCliLogin('https://agentrig.ai')).resolves.toEqual({
      requestId: 'request-1',
      publicCode: 'ABCD-1234',
      exchangeSecret: 'secret',
      expiresAt: 123,
      verificationUrl: 'https://agentrig.ai/cli/auth/request-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://agentrig.ai/api/cli/auth/start',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('exchanges a login request without retries on pending', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'pending', expiresAt: 123 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(exchangeCliLogin('https://agentrig.ai', 'request-1', 'secret')).resolves.toEqual({
      status: 'pending',
      expiresAt: 123,
    })
  })

  it('sends auth header for whoami and logout', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: 'user-1', email: 'tim@example.com', name: 'Tim' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(whoAmI('https://agentrig.ai', 'token-1')).resolves.toEqual({
      userId: 'user-1',
      email: 'tim@example.com',
      name: 'Tim',
    })
    await expect(logout('https://agentrig.ai', 'token-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://agentrig.ai/api/cli/whoami',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer token-1',
        }),
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://agentrig.ai/api/cli/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer token-1',
        }),
      })
    )
  })

  it('fetches the pack upload policy for authenticated users', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    )

    await expect(getPackUploadPolicy('https://agentrig.ai', 'token-1')).resolves.toEqual({
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
  })

  it('raises status-aware errors', async () => {
    fetchMock.mockResolvedValue(
      new Response('Unauthorized', {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      })
    )

    await expect(whoAmI('https://agentrig.ai', 'bad-token')).rejects.toMatchObject({
      name: 'CommunityApiError',
      status: 401,
      message: 'Unauthorized',
    })
  })

  it('creates upload sessions and fetches submission status', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadUrl: 'https://upload.example.com' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ storageId: 'storage-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ submissionId: 'submission-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            _id: 'submission-1',
            fileName: 'demo-pack.zip',
            status: 'pending_scan',
            scanStatus: 'pending',
            createdAt: 1,
            updatedAt: 2,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )

    await expect(getPackUploadUrl('https://agentrig.ai', 'token-1')).resolves.toBe(
      'https://upload.example.com'
    )
    await expect(uploadPackBundle('https://upload.example.com', new Uint8Array([1, 2]))).resolves.toBe(
      'storage-1'
    )
    await expect(
      createPackSubmission('https://agentrig.ai', 'token-1', {
        storageId: 'storage-1',
        fileName: 'demo-pack.zip',
        fileSize: 2,
        contentType: 'application/zip',
      })
    ).resolves.toBe('submission-1')
    await expect(
      getPackSubmissionStatus('https://agentrig.ai', 'token-1', 'submission-1')
    ).resolves.toMatchObject({
      _id: 'submission-1',
      status: 'pending_scan',
    })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          submissions: [
            {
              _id: 'submission-1',
              fileName: 'demo-pack.zip',
              status: 'pending_scan',
              scanStatus: 'pending',
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    )
    await expect(listPackSubmissions('https://agentrig.ai', 'token-1', 20)).resolves.toHaveLength(1)
  })
})
