import { beforeEach, describe, expect, it, vi } from 'vitest'
import registryCommand from '../../src/commands/registry'
import listCommand from '../../src/commands/registry/list'
import addCommand from '../../src/commands/registry/add'
import { loadConfig, getProjectConfigPath } from '../../src/lib/config'
import { ensureDir, readJsonFile, writeJsonFile } from '../../src/lib/fs'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
  getProjectConfigPath: vi.fn(),
  getGlobalConfigPath: vi.fn(),
}))
vi.mock('../../src/lib/fs', () => ({
  ensureDir: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
}))

describe('command:registry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('shows usage for registry wrapper', async () => {
    await registryCommand.run({ args: { help: false } })
  })

  it('lists configured registries', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [{ name: 'default', url: 'https://registry.example.com' }],
    })

    await listCommand.run({ args: { cwd: '/repo', help: false } })
    expect(loadConfig).toHaveBeenCalledWith('/repo')
  })

  it('adds or updates a registry in project config', async () => {
    vi.mocked(getProjectConfigPath).mockReturnValue('/repo/agentrig.config.json')
    vi.mocked(readJsonFile).mockResolvedValue({
      $schema: 'https://agentrig.dev/schema/config.json',
      registries: [{ name: 'default', url: 'https://old.example.com' }],
    })

    await addCommand.run({
      args: {
        name: 'default',
        url: 'https://new.example.com',
        cwd: '/repo',
        global: false,
        help: false,
      },
    })

    expect(ensureDir).toHaveBeenCalled()
    expect(writeJsonFile).toHaveBeenCalledWith('/repo/agentrig.config.json', {
      $schema: 'https://agentrig.dev/schema/config.json',
      registries: [{ name: 'default', url: 'https://new.example.com' }],
    })
  })
})
