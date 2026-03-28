import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/login'
import { saveAuthSession } from '../../src/lib/auth'
import { openExternalUrl } from '../../src/lib/browser'
import { exchangeCliLogin, resolveCommunityBaseUrl, startCliLogin } from '../../src/lib/community-api'

vi.mock('../../src/lib/auth', () => ({
  saveAuthSession: vi.fn(),
}))

vi.mock('../../src/lib/browser', () => ({
  openExternalUrl: vi.fn(),
}))

vi.mock('../../src/lib/community-api', () => ({
  exchangeCliLogin: vi.fn(),
  resolveCommunityBaseUrl: vi.fn(),
  startCliLogin: vi.fn(),
}))

describe('command:login', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(resolveCommunityBaseUrl).mockReturnValue('https://agentrig.ai')
  })

  it('starts browser login, stores the token, and prints who logged in', async () => {
    vi.mocked(startCliLogin).mockResolvedValue({
      requestId: 'request-1',
      publicCode: 'ABCD-1234',
      exchangeSecret: 'secret',
      expiresAt: Date.now() + 10_000,
      verificationUrl: 'https://agentrig.ai/cli/auth/request-1',
    })
    vi.mocked(openExternalUrl).mockResolvedValue(true)
    vi.mocked(exchangeCliLogin).mockResolvedValue({
      status: 'approved',
      accessToken: 'token-1',
      expiresAt: Date.now() + 60_000,
      user: { userId: 'user-1', name: 'Tim', email: 'tim@example.com' },
    })

    await run({
      args: {
        baseUrl: undefined,
        help: false,
      },
    })

    expect(startCliLogin).toHaveBeenCalledWith('https://agentrig.ai')
    expect(openExternalUrl).toHaveBeenCalledWith('https://agentrig.ai/cli/auth/request-1')
    expect(saveAuthSession).toHaveBeenCalledWith({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'token-1',
      expiresAt: expect.any(Number),
      userId: 'user-1',
      email: 'tim@example.com',
      name: 'Tim',
    })
    expect(console.log).toHaveBeenCalledWith('eingeloggt als Tim')
  })

  it('prints a manual browser url when auto-open fails', async () => {
    vi.mocked(startCliLogin).mockResolvedValue({
      requestId: 'request-1',
      publicCode: 'ABCD-1234',
      exchangeSecret: 'secret',
      expiresAt: Date.now() + 10_000,
      verificationUrl: 'https://agentrig.ai/cli/auth/request-1',
    })
    vi.mocked(openExternalUrl).mockResolvedValue(false)
    vi.mocked(exchangeCliLogin).mockResolvedValue({
      status: 'approved',
      accessToken: 'token-1',
      expiresAt: Date.now() + 60_000,
      user: { userId: 'user-1' },
    })

    await run({
      args: {
        help: false,
      },
    })

    expect(console.log).toHaveBeenCalledWith(
      'Open this URL in your browser: https://agentrig.ai/cli/auth/request-1'
    )
    expect(console.log).toHaveBeenCalledWith('eingeloggt als user-1')
  })
})
