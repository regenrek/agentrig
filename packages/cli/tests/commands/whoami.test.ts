import { beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/whoami'
import { clearAuthSession, loadAuthSession } from '../../src/lib/auth'
import { CommunityApiError, resolveCommunityBaseUrl, whoAmI } from '../../src/lib/community-api'

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
  resolveCommunityBaseUrl: vi.fn(),
  whoAmI: vi.fn(),
}))

describe('command:whoami', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(resolveCommunityBaseUrl).mockReturnValue('https://agentrig.ai')
  })

  it('prints the current user', async () => {
    vi.mocked(loadAuthSession).mockResolvedValue({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'token-1',
      expiresAt: 123,
      userId: 'user-1',
    })
    vi.mocked(whoAmI).mockResolvedValue({
      userId: 'user-1',
      email: 'tim@example.com',
      name: 'Tim',
    })

    await run({ args: { help: false } })

    expect(whoAmI).toHaveBeenCalledWith('https://agentrig.ai', 'token-1')
    expect(console.log).toHaveBeenCalledWith('eingeloggt als Tim')
  })

  it('clears invalid sessions on unauthorized', async () => {
    vi.mocked(loadAuthSession).mockResolvedValue({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'token-1',
      expiresAt: 123,
      userId: 'user-1',
    })
    vi.mocked(whoAmI).mockRejectedValue(new CommunityApiError('Unauthorized', 401))

    await expect(run({ args: { help: false } })).rejects.toThrow(
      'Stored CLI login is no longer valid. Run `agentrig login` again.'
    )

    expect(clearAuthSession).toHaveBeenCalledOnce()
  })
})
