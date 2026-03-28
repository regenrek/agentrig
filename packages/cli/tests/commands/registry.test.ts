import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import registryCommand from '../../src/commands/registry'
import listCommand from '../../src/commands/registry/list'
import addCommand from '../../src/commands/registry/add'
import type { ResolvedConfig } from '../../src/lib/config'
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
  const runRegistry = registryCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const runList = listCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const runAdd = addCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('shows usage for registry wrapper', async () => {
    await runRegistry({ args: { help: false } })
  })

  it('lists configured registries', async () => {
    const cfg: ResolvedConfig = {
      registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)

    await runList({ args: { cwd: '/repo', help: false } })
    expect(loadConfig).toHaveBeenCalledWith('/repo')
  })

  it('adds or updates a registry in project config', async () => {
    vi.mocked(getProjectConfigPath).mockReturnValue('/repo/agentrig.config.json')
    vi.mocked(readJsonFile).mockResolvedValue({
      $schema: 'https://agentrig.ai/schema/config.json',
      registries: [{ name: 'georg', url: 'https://old.example.com' }],
    })

    await runAdd({
      args: {
        name: 'georg',
        url: 'https://new.example.com',
        cwd: '/repo',
        global: false,
        help: false,
      },
    })

    expect(ensureDir).toHaveBeenCalled()
    expect(writeJsonFile).toHaveBeenCalledWith('/repo/agentrig.config.json', {
      $schema: 'https://agentrig.ai/schema/config.json',
      registries: [{ name: 'georg', url: 'https://new.example.com' }],
    })
  })
})
