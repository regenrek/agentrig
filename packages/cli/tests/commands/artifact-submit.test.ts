import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadAuthSession: vi.fn(),
  createPluginSubmission: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: mocks.loadAuthSession,
}))

vi.mock('../../src/lib/community-api', () => ({
  createPluginSubmission: mocks.createPluginSubmission,
  resolveCommunityBaseUrl: mocks.resolveCommunityBaseUrl,
}))

import { createArtifactKindCommand } from '../../src/commands/artifact-kind-install'

describe('command:artifact submit', () => {
  const skillCommand = createArtifactKindCommand('skill')
  const submit = (skillCommand.subCommands as Record<string, { run?: unknown }>).submit
  const run = submit?.run as (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.loadAuthSession.mockResolvedValue({
      accessToken: 'token',
      baseUrl: 'https://agentrig.ai',
    })
    mocks.resolveCommunityBaseUrl.mockReturnValue('https://agentrig.ai')
    mocks.createPluginSubmission.mockResolvedValue({
      submissionId: 'submission-123',
      deduped: false,
    })
  })

  it('routes skill submit through canonical plugin submissions', async () => {
    await run({
      args: {
        baseUrl: undefined,
        upstreamRepo: 'https://github.com/acme/tools',
        upstreamTag: 'v1.2.3',
        upstreamCommitSha: '1234567890abcdef1234567890abcdef12345678',
        artifactPath: 'skills/review',
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.createPluginSubmission).toHaveBeenCalledWith(
      'https://agentrig.ai',
      'token',
      {
        upstream_repo: 'https://github.com/acme/tools',
        upstream_tag: 'v1.2.3',
        upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
        plugin_path: 'skills/review',
      },
    )
  })

  it('prints the canonical plugin payload without submitting in dry-run mode', async () => {
    await run({
      args: {
        baseUrl: undefined,
        upstreamRepo: 'https://github.com/acme/tools',
        upstreamTag: 'v1.2.3',
        upstreamCommitSha: '1234567890abcdef1234567890abcdef12345678',
        artifactPath: 'skills/review',
        dryRun: true,
        help: false,
      },
    })

    expect(mocks.createPluginSubmission).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Publish shape: plugin_selected')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"plugin_path": "skills/review"'))
  })
})
