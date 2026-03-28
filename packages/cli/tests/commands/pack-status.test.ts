import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/pack/status'
import { loadAuthSession } from '../../src/lib/auth'
import {
  getPackSubmissionStatus,
  listPackSubmissions,
  resolveCommunityBaseUrl,
} from '../../src/lib/community-api'
import { selectOption } from '../../src/lib/interactive'

vi.mock('../../src/lib/auth', () => ({
  loadAuthSession: vi.fn(),
}))

vi.mock('../../src/lib/community-api', () => ({
  getPackSubmissionStatus: vi.fn(),
  listPackSubmissions: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
}))

vi.mock('../../src/lib/interactive', () => ({
  selectOption: vi.fn(),
}))

describe('command:pack:status', () => {
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
  })

  it('prints submission status details', async () => {
    vi.mocked(getPackSubmissionStatus).mockResolvedValue({
      _id: 'submission-1',
      fileName: 'demo-pack-1.2.3.zip',
      status: 'pending_review',
      scanStatus: 'warn',
      scanWarnings: ['README.md is missing'],
      reviewStatus: 'pending',
      packName: 'demo-pack',
      packVersion: '1.2.3',
      createdAt: 1,
      updatedAt: 2,
    })

    await run({ args: { submissionId: 'submission-1', help: false } })

    expect(console.log).toHaveBeenCalledWith('Submission: submission-1')
    expect(console.log).toHaveBeenCalledWith('Status: pending_review')
    expect(console.log).toHaveBeenCalledWith('Scan status: warn')
    expect(console.log).toHaveBeenCalledWith('Pack: demo-pack@1.2.3')
  })

  it('lists and selects a submission when no id was provided', async () => {
    vi.mocked(listPackSubmissions).mockResolvedValue([
      {
        _id: 'submission-1',
        fileName: 'demo-pack-1.2.3.zip',
        status: 'pending_review',
        scanStatus: 'warn',
        packName: 'demo-pack',
        packVersion: '1.2.3',
        createdAt: 1,
        updatedAt: 2,
      },
    ])
    vi.mocked(selectOption).mockResolvedValue({
      _id: 'submission-1',
      fileName: 'demo-pack-1.2.3.zip',
      status: 'pending_review',
      scanStatus: 'warn',
      packName: 'demo-pack',
      packVersion: '1.2.3',
      createdAt: 1,
      updatedAt: 2,
    })
    vi.mocked(getPackSubmissionStatus).mockResolvedValue({
      _id: 'submission-1',
      fileName: 'demo-pack-1.2.3.zip',
      status: 'pending_review',
      scanStatus: 'warn',
      createdAt: 1,
      updatedAt: 2,
    })

    await run({ args: { help: false } })

    expect(listPackSubmissions).toHaveBeenCalledWith('https://agentrig.ai', 'token-1', 20)
    expect(selectOption).toHaveBeenCalled()
    expect(getPackSubmissionStatus).toHaveBeenCalledWith(
      'https://agentrig.ai',
      'token-1',
      'submission-1'
    )
  })

  it('prints a friendly message when no submissions exist', async () => {
    vi.mocked(listPackSubmissions).mockResolvedValue([])

    await run({ args: { help: false } })

    expect(console.log).toHaveBeenCalledWith('No submitted packs found.')
  })
})
