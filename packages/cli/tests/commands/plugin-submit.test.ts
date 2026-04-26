import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadAuthSession: vi.fn(),
  createPluginSubmission: vi.fn(),
  getPluginSubmissionStatus: vi.fn(),
  mintPublishToken: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
  hasGitHubActionsOidcEnv: vi.fn(),
  requestGitHubActionsOidcToken: vi.fn(),
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

import command from '../../src/commands/plugin/submit'

describe('command:plugin submit', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.GITHUB_REPOSITORY
    delete process.env.GITHUB_SERVER_URL
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
  })

  it('submits the canonical submission payload', async () => {
    await run({
      args: {
        baseUrl: undefined,
        upstreamRepo: 'https://github.com/acme/demo-plugin',
        upstreamTag: 'v1.2.3',
        upstreamCommitSha: '1234567890abcdef1234567890abcdef12345678',
        pluginPath: 'plugin',
        artifactId: undefined,
        trustedPublish: false,
        dryRun: false,
        help: false,
      },
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
        upstreamRepo: 'https://github.com/acme/demo-plugin',
        upstreamTag: 'v1.2.3',
        upstreamCommitSha: '1234567890abcdef1234567890abcdef12345678',
        pluginPath: 'plugin',
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
    process.env.GITHUB_SERVER_URL = 'https://github.com'
    process.env.GITHUB_REF_NAME = 'v1.2.3'
    process.env.GITHUB_SHA = '1234567890abcdef1234567890abcdef12345678'

    await run({
      args: {
        baseUrl: undefined,
        upstreamRepo: undefined,
        upstreamTag: undefined,
        upstreamCommitSha: undefined,
        pluginPath: '.',
        artifactId: 'acme.demo-plugin',
        trustedPublish: false,
        dryRun: false,
        help: false,
      },
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
})
