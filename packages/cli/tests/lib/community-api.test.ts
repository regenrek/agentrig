import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CommunityApiError,
  createPluginSubmission,
  exchangeCliLogin,
  getPluginSubmissionStatus,
  listPluginSubmissions,
  logout,
  mintPublishToken,
  resolveCommunityBaseUrl,
  startCliLogin,
  whoAmI,
} from '../../src/lib/community-api'

describe('community api client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('normalizes and validates community base URLs', () => {
    expect(resolveCommunityBaseUrl(undefined, 'https://agentrig.test/community?x=1#top')).toBe(
      'https://agentrig.test/community'
    )

    vi.stubEnv('AGENTRIG_BASE_URL', 'http://localhost:3000/')
    expect(resolveCommunityBaseUrl()).toBe('http://localhost:3000')
    expect(() => resolveCommunityBaseUrl('not a url')).toThrow(/Invalid AgentRig base URL/)
    expect(() => resolveCommunityBaseUrl('file:///tmp/agentrig')).toThrow(/protocol/)
  })

  it('posts publish-token mint requests with the generated plugin shape', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'publish-token', expiresAt: 123 }), {
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await mintPublishToken('https://agentrig.test', {
      artifactKind: 'plugin',
      artifactId: 'acme.tools',
      publishShape: { kind: 'generated_plugin', selectors: ['skill:review'] },
      githubOidcToken: 'oidc-token',
    })

    expect(result).toEqual({ token: 'publish-token', expiresAt: 123 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://agentrig.test/api/cli/publish-token/mint',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          artifactKind: 'plugin',
          artifactId: 'acme.tools',
          publishShape: { kind: 'generated_plugin', selectors: ['skill:review'] },
          githubOidcToken: 'oidc-token',
        }),
        headers: expect.objectContaining({
          accept: 'application/json',
          'content-type': 'application/json',
        }),
      })
    )
  })

  it('sends bearer tokens for authenticated CLI endpoints', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/cli/auth/logout')) return new Response(null, { status: 204 })
      if (url.includes('/api/cli/plugins/submissions?limit=7')) {
        return jsonResponse({ submissions: [{ submissionId: 'sub-1' }] })
      }
      if (url.endsWith('/api/cli/plugins/submissions/sub-1')) {
        return jsonResponse({ submissionId: 'sub-1', status: 'approved' })
      }
      if (url.endsWith('/api/cli/plugins/submissions') && init?.method === 'POST') {
        return jsonResponse({ submissionId: 'sub-2', deduped: false })
      }
      return jsonResponse({ user: { id: 'user-1', email: 'dev@example.com' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(whoAmI('https://agentrig.test', 'access-token')).resolves.toMatchObject({
      user: { id: 'user-1' },
    })
    await expect(logout('https://agentrig.test', 'access-token')).resolves.toBeUndefined()
    await expect(listPluginSubmissions('https://agentrig.test', 'access-token', 7)).resolves.toEqual([
      { submissionId: 'sub-1' },
    ])
    await expect(getPluginSubmissionStatus('https://agentrig.test', 'access-token', 'sub-1')).resolves.toMatchObject({
      submissionId: 'sub-1',
      status: 'approved',
    })
    await expect(createPluginSubmission('https://agentrig.test', 'access-token', {
      upstream_repo: 'https://github.com/acme/tools',
      upstream_tag: 'v1.2.3',
      upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
      plugin_path: 'skills/review',
    })).resolves.toEqual({ submissionId: 'sub-2', deduped: false })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      })
    )
  })

  it('surfaces server error messages and retries retryable responses once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'try again' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ requestId: 'req-1', verificationUri: 'https://verify.test' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'bad code' }, { status: 400 }))
      .mockResolvedValueOnce(new Response('plain failure', { status: 500 }))
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(startCliLogin('https://agentrig.test')).resolves.toMatchObject({ requestId: 'req-1' })
    await expect(exchangeCliLogin('https://agentrig.test', 'req-1', 'secret')).rejects.toMatchObject({
      status: 400,
      message: 'bad code',
    } satisfies Partial<CommunityApiError>)
    await expect(whoAmI('https://agentrig.test', 'access-token')).rejects.toThrow('plain failure')
    await expect(exchangeCliLogin('https://agentrig.test', 'req-1', 'secret')).rejects.toThrow('network down')
  })
})

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
}
