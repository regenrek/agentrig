import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/list'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../src/lib/plugin-install-ledger'
import { isUrl, readRegistryIndex } from '../../src/lib/registry'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/plugin-install-ledger', () => ({
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
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
      registries: [{ name: 'official', url: 'https://registry.example.com' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'codex:workspace:agentrig-core',
        provider: 'codex',
        requestedScope: 'workspace',
        specIdentity: {
          kind: 'registry',
          registryUrl: 'https://agentrig.ai/registry',
          packName: 'core',
        },
        scope: 'workspace',
        packName: 'core',
        packVersion: '1.0.0',
        pluginName: 'agentrig-core',
        sourceLocation: '/tmp/agentrig-core',
        targetPaths: ['/repo/.codex/plugins/agentrig-core'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          pluginPath: '/repo/.codex/plugins/agentrig-core',
          marketplacePath: '/repo/.codex/marketplace.json',
          marketplaceEntry: {
            name: 'agentrig-core',
            source: { source: 'local', path: './plugins/agentrig-core' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        },
      },
    ])
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
        registry: 'official',
        help: false,
      },
    })

    expect(loadPluginInstallLedgers).toHaveBeenCalledWith('/repo')
    expect(readRegistryIndex).toHaveBeenCalledWith('https://registry.example.com')
  })
})
