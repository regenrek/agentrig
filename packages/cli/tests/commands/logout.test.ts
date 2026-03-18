import { beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/logout'
import { clearAuthSession, loadAuthSession } from '../../src/lib/auth'
import { CommunityApiError, logout as logoutRequest, resolveCommunityBaseUrl } from '../../src/lib/community-api'

vi.mock('../../src/lib/auth', () => ({
  clearAuthSession: vi.fn(),
  loadAuthSession: vi.fn(),
}))

vi.mock('../../src/lib/community-api', () => ({
  CommunityApiError: class CommunityApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  logout: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
}))

describe('command:logout', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(resolveCommunityBaseUrl).mockReturnValue('https://agentrig.ai')
  })

  it('revokes the current token and clears the local session', async () => {
    vi.mocked(loadAuthSession).mockResolvedValue({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'token-1',
      expiresAt: 123,
      userId: 'user-1',
    })

    await run({ args: { help: false } })

    expect(logoutRequest).toHaveBeenCalledWith('https://agentrig.ai', 'token-1')
    expect(clearAuthSession).toHaveBeenCalledOnce()
    expect(console.log).toHaveBeenCalledWith('Logged out.')
  })

  it('treats unauthorized server tokens as already logged out', async () => {
    vi.mocked(loadAuthSession).mockResolvedValue({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'token-1',
      expiresAt: 123,
      userId: 'user-1',
    })
    vi.mocked(logoutRequest).mockRejectedValue(new CommunityApiError('Unauthorized', 401))

    await run({ args: { help: false } })

    expect(clearAuthSession).toHaveBeenCalledOnce()
  })
})
