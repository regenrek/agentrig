import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/init'
import { pathExists } from '../../src/lib/fs'
import { getGlobalConfigPath, getProjectConfigPath, writeGlobalConfig, writeProjectConfig } from '../../src/lib/config'

vi.mock('../../src/lib/fs', () => ({
  pathExists: vi.fn(),
}))

vi.mock('../../src/lib/config', () => ({
  getGlobalConfigPath: vi.fn(),
  getProjectConfigPath: vi.fn(),
  writeGlobalConfig: vi.fn(),
  writeProjectConfig: vi.fn(),
}))

describe('command:init', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('writes a minimal global config', async () => {
    vi.mocked(getGlobalConfigPath).mockReturnValue('/home/.agentrig/config.json')
    vi.mocked(pathExists).mockResolvedValue(false)

    await run({
      args: {
        cwd: '/repo',
        registry: 'https://registry.example.com',
        global: true,
        force: false,
        help: false,
      },
    })

    expect(writeGlobalConfig).toHaveBeenCalledWith({
      $schema: 'https://agentrig.ai/schema/config.json',
      registries: [{ name: 'agentrig', url: 'https://registry.example.com' }],
    })
  })

  it('refuses to overwrite existing project config without force', async () => {
    vi.mocked(getProjectConfigPath).mockReturnValue('/repo/agentrig.config.json')
    vi.mocked(pathExists).mockResolvedValue(true)

    await expect(
      run({
        args: {
          cwd: '/repo',
          global: false,
          force: false,
          help: false,
        },
      })
    ).rejects.toThrow('Project config already exists')
  })

  it('writes a minimal project config when allowed', async () => {
    vi.mocked(getProjectConfigPath).mockReturnValue('/repo/agentrig.config.json')
    vi.mocked(pathExists).mockResolvedValue(false)

    await run({
      args: {
        cwd: '/repo',
        global: false,
        force: true,
        help: false,
      },
    })

    expect(writeProjectConfig).toHaveBeenCalledWith('/repo', expect.objectContaining({
      $schema: 'https://agentrig.ai/schema/config.json',
      registries: [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }],
    }))
  })
})
