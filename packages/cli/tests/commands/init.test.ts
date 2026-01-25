import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('writes a minimal global config', async () => {
    vi.mocked(getGlobalConfigPath).mockReturnValue('/home/.agentrig/config.json')
    vi.mocked(pathExists).mockResolvedValue(false)

    await command.run({
      args: {
        cwd: '/repo',
        skillsDir: 'custom-skills',
        registry: 'https://registry.example.com',
        defaultRig: 'custom',
        minimal: true,
        global: true,
        force: false,
        help: false,
      },
    })

    expect(writeGlobalConfig).toHaveBeenCalledWith({
      $schema: 'https://agentrig.dev/schema/config.json',
      skillsDir: 'custom-skills',
      defaultRig: 'custom',
      registries: [{ name: 'default', url: 'https://registry.example.com' }],
    })
  })

  it('refuses to overwrite existing project config without force', async () => {
    vi.mocked(getProjectConfigPath).mockReturnValue('/repo/agentrig.config.json')
    vi.mocked(pathExists).mockResolvedValue(true)

    await expect(
      command.run({
        args: {
          cwd: '/repo',
          skillsDir: undefined,
          registry: undefined,
          defaultRig: undefined,
          minimal: false,
          global: false,
          force: false,
          help: false,
        },
      })
    ).rejects.toThrow('Project config already exists')
  })

  it('writes a full project config when allowed', async () => {
    vi.mocked(getProjectConfigPath).mockReturnValue('/repo/agentrig.config.json')
    vi.mocked(pathExists).mockResolvedValue(false)

    await command.run({
      args: {
        cwd: '/repo',
        skillsDir: '.codex/skills',
        registry: undefined,
        defaultRig: 'core',
        minimal: false,
        global: false,
        force: true,
        help: false,
      },
    })

    expect(writeProjectConfig).toHaveBeenCalledWith('/repo', expect.objectContaining({
      $schema: 'https://agentrig.dev/schema/config.json',
      skillsDir: '.codex/skills',
      defaultRig: 'core',
      rigs: expect.any(Object),
    }))
  })
})
