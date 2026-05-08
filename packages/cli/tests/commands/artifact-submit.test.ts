import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAuthSession: vi.fn(),
  createPluginSubmission: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
  resolveSubmitSource: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: mocks.loadAuthSession,
}))

vi.mock('../../src/lib/community-api', () => ({
  createPluginSubmission: mocks.createPluginSubmission,
  resolveCommunityBaseUrl: mocks.resolveCommunityBaseUrl,
}))

vi.mock('../../src/lib/submit-source', () => ({
  resolveSubmitSource: mocks.resolveSubmitSource,
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
    mocks.resolveSubmitSource.mockResolvedValue({
      upstream_repo: 'https://github.com/acme/tools',
      upstream_tag: 'v1.2.3',
      upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
      plugin_path: 'skills/review',
    })
  })

  it('routes skill submit through canonical plugin submissions', async () => {
    await run({
      args: {
        baseUrl: undefined,
        source: 'acme/tools@v1.2.3',
        version: undefined,
        path: 'skills/review',
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolveSubmitSource).toHaveBeenCalledWith({
      source: 'acme/tools@v1.2.3',
      version: undefined,
      path: 'skills/review',
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
        source: 'https://github.com/acme/tools',
        version: '1.2.3',
        path: 'skills/review',
        dryRun: true,
        help: false,
      },
    })

    expect(mocks.createPluginSubmission).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('Submission type: canonical upstream review')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"plugin_path": "skills/review"'))
  })
})
