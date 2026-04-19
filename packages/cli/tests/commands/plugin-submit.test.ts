import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAuthSession: vi.fn(),
  createPluginSubmission: vi.fn(),
  getPluginSubmissionStatus: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: mocks.loadAuthSession,
}))

vi.mock('../../src/lib/community-api', () => ({
  createPluginSubmission: mocks.createPluginSubmission,
  getPluginSubmissionStatus: mocks.getPluginSubmissionStatus,
  resolveCommunityBaseUrl: mocks.resolveCommunityBaseUrl,
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
    mocks.createPluginSubmission.mockResolvedValue({
      submissionId: 'submission-123',
      deduped: false,
    })
    mocks.getPluginSubmissionStatus.mockResolvedValue({ status: 'pending_review' })
  })

  it('submits the canonical submission payload', async () => {
    await run({
      args: {
        baseUrl: undefined,
        upstreamRepo: 'https://github.com/acme/demo-plugin',
        upstreamTag: 'v1.2.3',
        upstreamCommitSha: '1234567890abcdef1234567890abcdef12345678',
        pluginPath: 'plugin',
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
})
