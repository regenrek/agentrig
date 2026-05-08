import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAuthSession: vi.fn(),
  createPluginSubmission: vi.fn(),
  getPluginSubmissionStatus: vi.fn(),
  mintPublishToken: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
  hasGitHubActionsOidcEnv: vi.fn(),
  requestGitHubActionsOidcToken: vi.fn(),
  resolveSubmitSource: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: mocks.loadAuthSession,
}))

vi.mock('../../src/lib/community-api', () => ({
  createPluginSubmission: mocks.createPluginSubmission,
  getPluginSubmissionStatus: mocks.getPluginSubmissionStatus,
  mintPublishToken: mocks.mintPublishToken,
  resolveCommunityBaseUrl: mocks.resolveCommunityBaseUrl,
}))

vi.mock('../../src/lib/github-actions-oidc', () => ({
  hasGitHubActionsOidcEnv: mocks.hasGitHubActionsOidcEnv,
  requestGitHubActionsOidcToken: mocks.requestGitHubActionsOidcToken,
}))

vi.mock('../../src/lib/submit-source', () => ({
  resolveSubmitSource: mocks.resolveSubmitSource,
}))

import command from '../../src/commands/plugin/submit'

describe('command:plugin submit', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.GITHUB_REPOSITORY
    delete process.env.GITHUB_REF_NAME
    delete process.env.GITHUB_SHA
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.loadAuthSession.mockResolvedValue({
      accessToken: 'token',
      baseUrl: 'https://agentrig.ai',
    })
    mocks.resolveCommunityBaseUrl.mockReturnValue('https://agentrig.ai')
    mocks.createPluginSubmission.mockResolvedValue({
      submissionId: 'submission-123',
      deduped: false,
    })
    mocks.mintPublishToken.mockResolvedValue({
      token: 'publish-token',
      expiresAt: Date.now() + 600_000,
    })
    mocks.getPluginSubmissionStatus.mockResolvedValue({ status: 'pending_review' })
    mocks.hasGitHubActionsOidcEnv.mockReturnValue(false)
    mocks.requestGitHubActionsOidcToken.mockResolvedValue('github-oidc-token')
    mocks.resolveSubmitSource.mockResolvedValue({
      upstream_repo: 'https://github.com/acme/demo-plugin',
      upstream_tag: 'v1.2.3',
      upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
      plugin_path: 'plugin',
    })
  })

  it('resolves the source and submits the canonical submission payload', async () => {
    await run({
      args: {
        baseUrl: undefined,
        source: 'acme/demo-plugin@v1.2.3',
        version: undefined,
        path: 'plugin',
        artifactId: undefined,
        trustedPublish: false,
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolveSubmitSource).toHaveBeenCalledWith({
      source: 'acme/demo-plugin@v1.2.3',
      version: undefined,
      path: 'plugin',
      expectedCommitSha: undefined,
    })
    expect(mocks.createPluginSubmission).toHaveBeenCalledWith(
      'https://agentrig.ai',
      'token',
      {
        upstream_repo: 'https://github.com/acme/demo-plugin',
        upstream_tag: 'v1.2.3',
        upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
        plugin_path: 'plugin',
      },
    )
  })

  it('prints the canonical payload without submitting in dry-run mode', async () => {
    await run({
      args: {
        baseUrl: undefined,
        source: 'https://github.com/acme/demo-plugin',
        version: '1.2.3',
        path: 'plugin',
        artifactId: undefined,
        trustedPublish: false,
        dryRun: true,
        help: false,
      },
    })

    expect(mocks.createPluginSubmission).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Publish shape: plugin_all')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"plugin_path": "plugin"'))
  })

  it('uses GitHub Actions OIDC to mint a publish token without a login session', async () => {
    mocks.loadAuthSession.mockResolvedValue(null)
    mocks.hasGitHubActionsOidcEnv.mockReturnValue(true)
    process.env.GITHUB_REPOSITORY = 'acme/demo-plugin'
    process.env.GITHUB_REF_NAME = 'v1.2.3'
    process.env.GITHUB_SHA = '1234567890abcdef1234567890abcdef12345678'
    mocks.resolveSubmitSource.mockResolvedValue({
      upstream_repo: 'https://github.com/acme/demo-plugin',
      upstream_tag: 'v1.2.3',
      upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
      plugin_path: '.',
    })

    await run({
      args: {
        baseUrl: undefined,
        source: undefined,
        version: undefined,
        path: undefined,
        artifactId: 'acme.demo-plugin',
        trustedPublish: false,
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolveSubmitSource).toHaveBeenCalledWith({
      source: 'acme/demo-plugin@v1.2.3',
      version: undefined,
      path: undefined,
      expectedCommitSha: '1234567890abcdef1234567890abcdef12345678',
    })
    expect(mocks.mintPublishToken).toHaveBeenCalledWith('https://agentrig.ai', {
      artifactKind: 'plugin',
      artifactId: 'acme.demo-plugin',
      version: undefined,
      publishShape: { kind: 'plugin_all' },
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      githubOidcToken: 'github-oidc-token',
    })
    expect(mocks.createPluginSubmission).toHaveBeenCalledWith(
      'https://agentrig.ai',
      'publish-token',
      {
        upstream_repo: 'https://github.com/acme/demo-plugin',
        upstream_tag: 'v1.2.3',
        upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
        plugin_path: '.',
      },
    )
    expect(mocks.getPluginSubmissionStatus).not.toHaveBeenCalled()
  })

  it('fails trusted publishing before minting when the source does not match GITHUB_SHA', async () => {
    mocks.loadAuthSession.mockResolvedValue(null)
    mocks.hasGitHubActionsOidcEnv.mockReturnValue(true)
    process.env.GITHUB_REPOSITORY = 'acme/demo-plugin'
    process.env.GITHUB_REF_NAME = 'v1.2.3'
    process.env.GITHUB_SHA = '1234567890abcdef1234567890abcdef12345678'
    mocks.resolveSubmitSource.mockRejectedValue(new Error('Resolved submit source commit mismatch'))

    await expect(run({
      args: {
        baseUrl: undefined,
        source: undefined,
        version: undefined,
        path: undefined,
        artifactId: 'acme.demo-plugin',
        trustedPublish: false,
        dryRun: false,
        help: false,
      },
    })).rejects.toThrow('commit mismatch')

    expect(mocks.mintPublishToken).not.toHaveBeenCalled()
    expect(mocks.createPluginSubmission).not.toHaveBeenCalled()
  })
})
