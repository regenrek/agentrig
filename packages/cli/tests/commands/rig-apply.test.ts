import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolvePluginGraph: vi.fn(),
  materializeResolvedPluginGraph: vi.fn(),
  cleanupMaterializedPlugin: vi.fn(),
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
  buildResolvedPluginInstallMetadataMap: vi.fn(),
  installPreparedPluginProviders: vi.fn(),
  parsePluginInstallScopeSelector: vi.fn(),
  parsePluginProviderSelector: vi.fn(),
  preparePluginInstall: vi.fn(),
  uninstallPluginProviders: vi.fn(),
}))

vi.mock('../../src/lib/config', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../../src/lib/plugin-consumer', () => ({
  resolvePluginGraph: mocks.resolvePluginGraph,
  materializeResolvedPluginGraph: mocks.materializeResolvedPluginGraph,
  cleanupMaterializedPlugin: mocks.cleanupMaterializedPlugin,
}))

vi.mock('../../src/lib/plugin-install-ledger', () => ({
  loadPluginInstallLedgers: mocks.loadPluginInstallLedgers,
  listPluginInstallRecords: mocks.listPluginInstallRecords,
}))

vi.mock('../../src/lib/plugin-install-spec', () => ({
  buildResolvedPluginInstallMetadataMap: mocks.buildResolvedPluginInstallMetadataMap,
  getPluginInstallSpecIdentityKey: vi.fn((identity: { pluginId: string; version: string }) =>
    `${identity.pluginId}@${identity.version}`
  ),
}))

vi.mock('../../src/lib/plugin-providers', () => ({
  installPreparedPluginProviders: mocks.installPreparedPluginProviders,
  parsePluginInstallScopeSelector: mocks.parsePluginInstallScopeSelector,
  parsePluginProviderSelector: mocks.parsePluginProviderSelector,
  preparePluginInstall: mocks.preparePluginInstall,
  uninstallPluginProviders: mocks.uninstallPluginProviders,
}))

import command from '../../src/commands/rig/apply'

describe('command:rig apply', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.parsePluginProviderSelector.mockReturnValue('codex')
    mocks.parsePluginInstallScopeSelector.mockReturnValue('auto')
    mocks.loadConfig.mockResolvedValue({
      registries: [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }],
      rigs: {
        core: {
          plugins: ['agentrig/agentrig.core-committer@0.1.0'],
        },
      },
      defaultRig: 'core',
    })
    mocks.resolvePluginGraph.mockResolvedValue({
      requestedPlugin: {
        listing: { artifactId: 'agentrig.core-committer', version: '0.1.0', slug: 'agentrig-core-committer' },
      },
      resolvedPlugins: [
        {
          listing: { artifactId: 'agentrig.core-committer', version: '0.1.0', slug: 'agentrig-core-committer' },
        },
      ],
    })
  })

  it('fails before install planning when materialization rejects a rig bundle', async () => {
    mocks.materializeResolvedPluginGraph.mockRejectedValueOnce(new Error('sha256_mismatch'))

    await expect(
      run({
        args: {
          provider: 'codex',
          name: 'core',
          cwd: '/repo',
          scope: undefined,
          force: false,
          prune: true,
          dryRun: false,
          help: false,
        },
      }),
    ).rejects.toThrow(/sha256_mismatch/i)

    expect(mocks.preparePluginInstall).not.toHaveBeenCalled()
  })
})
