import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { clearAuthSession, loadAuthSession, saveAuthSession } from '../../src/lib/auth'
import { chmodIfPossible, readJsonFile, removeIfExists, writeJsonFile } from '../../src/lib/fs'
import { getGlobalAuthPath } from '../../src/lib/config'

vi.mock('../../src/lib/fs', () => ({
  chmodIfPossible: vi.fn(),
  readJsonFile: vi.fn(),
  removeIfExists: vi.fn(),
  writeJsonFile: vi.fn(),
}))

vi.mock('../../src/lib/config', () => ({
  getGlobalAuthPath: vi.fn(),
}))

describe('auth store', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getGlobalAuthPath).mockReturnValue('/home/tester/.agentrig/auth.json')
  })

  it('loads a stored auth session', async () => {
    vi.mocked(readJsonFile).mockResolvedValue({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'secret',
      expiresAt: 123,
      userId: 'user-1',
      email: 'tim@example.com',
      name: 'Tim',
    })

    await expect(loadAuthSession()).resolves.toEqual({
      baseUrl: 'https://agentrig.ai',
      accessToken: 'secret',
      expiresAt: 123,
      userId: 'user-1',
      email: 'tim@example.com',
      name: 'Tim',
    })
  })

  it('returns null when no auth session exists', async () => {
    vi.mocked(readJsonFile).mockResolvedValue(null)
    await expect(loadAuthSession()).resolves.toBeNull()
  })

  it('persists auth session with locked-down permissions', async () => {
    const session = {
      baseUrl: 'https://agentrig.ai',
      accessToken: 'secret',
      expiresAt: 123,
      userId: 'user-1',
      email: 'tim@example.com',
      name: 'Tim',
    }

    await saveAuthSession(session)

    expect(writeJsonFile).toHaveBeenCalledWith('/home/tester/.agentrig/auth.json', session)
    expect(chmodIfPossible).toHaveBeenCalledWith('/home/tester/.agentrig/auth.json', 0o600)
  })

  it('clears the persisted auth session', async () => {
    await clearAuthSession()
    expect(removeIfExists).toHaveBeenCalledWith('/home/tester/.agentrig/auth.json')
  })
})
