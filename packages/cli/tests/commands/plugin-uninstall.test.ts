import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
  normalizePluginInstallSpecIdentity: vi.fn(),
  isSamePluginInstallSpecIdentity: vi.fn(),
  getPluginInstallSpecIdentityKey: vi.fn(),
  resolvePluginSpec: vi.fn(),
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
  normalizePluginInstallSpecIdentity: mocks.normalizePluginInstallSpecIdentity,
  isSamePluginInstallSpecIdentity: mocks.isSamePluginInstallSpecIdentity,
  getPluginInstallSpecIdentityKey: mocks.getPluginInstallSpecIdentityKey,
}))

vi.mock('../../src/lib/plugin-resolver', () => ({
  resolvePluginSpec: mocks.resolvePluginSpec,
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
    mocks.loadConfig.mockResolvedValue({ registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }] })
    mocks.normalizePluginInstallSpecIdentity.mockReturnValue({
      kind: 'registry',
      registryUrl: 'https://agentrig.ai/registry',
      pluginId: 'demo-plugin',
    })
    mocks.isSamePluginInstallSpecIdentity.mockImplementation(
      (left: { pluginId?: string }, right: { pluginId?: string }) => left.pluginId === right.pluginId,
    )
    mocks.getPluginInstallSpecIdentityKey.mockImplementation(
      (identity: { pluginId?: string }) => identity.pluginId ?? 'unknown',
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
          registryUrl: 'https://agentrig.ai/registry',
          pluginId: 'demo-plugin',
        },
      },
    ])
    mocks.resolvePluginSpec.mockResolvedValue({
      manifest: {
        id: 'demo-plugin',
        name: 'Demo Plugin',
      },
    })
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

  it('matches uninstall records by canonical plugin id', async () => {
    await run({
      args: {
        provider: 'cursor',
        spec: 'demo-plugin',
        cwd: '/repo',
        scope: undefined,
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolvePluginSpec).toHaveBeenCalledWith(
      'demo-plugin',
      '/repo',
      [{ name: 'official', url: 'https://agentrig.ai/registry' }],
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
