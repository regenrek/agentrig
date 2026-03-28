import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/list'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import { loadManifest } from '../../src/lib/manifest'
import { isUrl, readRegistryIndex } from '../../src/lib/registry'
import type { Manifest } from '../../src/lib/types'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/manifest', () => ({
  loadManifest: vi.fn(),
}))
vi.mock('../../src/lib/registry', () => ({
  isUrl: vi.fn(),
  readRegistryIndex: vi.fn(),
}))

describe('command:list', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('lists installed and available packs', async () => {
    const cfg: ResolvedConfig = {
      skillsDir: '.codex/skills',
      registries: [{ name: 'default', url: 'https://registry.example.com' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    const manifest: Manifest = {
      schemaVersion: 1,
      installed: {
        core: { name: 'core', version: '1.0.0', source: 'registry:default', installedAt: '', files: [] },
      },
    }
    vi.mocked(loadManifest).mockResolvedValue(manifest)
    vi.mocked(isUrl).mockReturnValue(false)
    vi.mocked(readRegistryIndex).mockResolvedValue({
      name: 'registry',
      items: [
        { name: 'core', title: 'Core', description: 'Core pack', meta: 'core.json', version: '1.0.0' },
      ],
    })

    await run({
      args: {
        cwd: '/repo',
        installed: true,
        available: true,
        registry: 'default',
        help: false,
      },
    })

    expect(readRegistryIndex).toHaveBeenCalledWith('https://registry.example.com')
  })
})
