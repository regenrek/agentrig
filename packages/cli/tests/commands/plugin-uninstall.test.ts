import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
  resolvePluginInstallSpecIdentity: vi.fn(),
  isSamePluginInstallSpecIdentity: vi.fn(),
  parsePluginProviderSelector: vi.fn(),
  parsePluginInstallScopeSelector: vi.fn(),
  uninstallPluginProviders: vi.fn(),
}))

vi.mock('../../src/lib/config', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../../src/lib/plugin-install-ledger', () => ({
  loadPluginInstallLedgers: mocks.loadPluginInstallLedgers,
  listPluginInstallRecords: mocks.listPluginInstallRecords,
}))

vi.mock('../../src/lib/plugin-install-spec', () => ({
  resolvePluginInstallSpecIdentity: mocks.resolvePluginInstallSpecIdentity,
  isSamePluginInstallSpecIdentity: mocks.isSamePluginInstallSpecIdentity,
}))

vi.mock('../../src/lib/plugin-providers', () => ({
  parsePluginProviderSelector: mocks.parsePluginProviderSelector,
  parsePluginInstallScopeSelector: mocks.parsePluginInstallScopeSelector,
  uninstallPluginProviders: mocks.uninstallPluginProviders,
}))

import command from '../../src/commands/plugin/uninstall'

describe('command:plugin uninstall', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.parsePluginProviderSelector.mockReturnValue('cursor')
    mocks.loadPluginInstallLedgers.mockResolvedValue({})
    mocks.loadConfig.mockResolvedValue({ registries: [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }] })
    mocks.resolvePluginInstallSpecIdentity.mockResolvedValue({
      kind: 'registry',
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      pluginId: 'demo-plugin',
      version: '1.2.3',
    })
    mocks.isSamePluginInstallSpecIdentity.mockImplementation(
      (left: { pluginId?: string; version?: string }, right: { pluginId?: string; version?: string }) =>
        left.pluginId === right.pluginId && left.version === right.version,
    )
    mocks.listPluginInstallRecords.mockReturnValue([
      {
        provider: 'cursor',
        scope: 'workspace',
        pluginId: 'demo-plugin',
        pluginName: 'Demo Plugin',
        targetPaths: ['/repo/.cursor/plugins/local/demo-plugin'],
        specIdentity: {
          kind: 'registry',
          registryAlias: 'agentrig',
          registryUrl: 'https://agentrig.ai/registry',
          pluginId: 'demo-plugin',
          version: '1.2.3',
        },
      },
    ])
    mocks.uninstallPluginProviders.mockResolvedValue([
      {
        provider: 'cursor',
        removed: ['/repo/.cursor/plugins/local/demo-plugin'],
        kept: [],
        missing: [],
        locations: ['/repo/.cursor/plugins/local/demo-plugin'],
      },
    ])
  })

  it('matches uninstall records by canonical latest-first registry install ref', async () => {
    await run({
      args: {
        provider: 'cursor',
        spec: 'agentrig/demo-plugin',
        cwd: '/repo',
        scope: undefined,
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolvePluginInstallSpecIdentity).toHaveBeenCalledWith(
      'agentrig/demo-plugin',
      '/repo',
      [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }],
    )
    expect(mocks.uninstallPluginProviders).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          pluginId: 'demo-plugin',
          pluginName: 'Demo Plugin',
        }),
      ],
      { cwd: '/repo', dryRun: false },
    )
  })
})
