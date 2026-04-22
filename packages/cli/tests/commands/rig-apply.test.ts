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
  assertInstallableTrust: vi.fn(),
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

vi.mock('../../src/lib/trust', () => ({
  assertInstallableTrust: mocks.assertInstallableTrust,
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
        manifest: { id: 'agentrig.core-committer', version: '0.1.0' },
        sourceLabel: 'agentrig/agentrig.core-committer@0.1.0',
        trustTier: 'official',
        installability: 'installable',
      },
      resolvedPlugins: [
        {
          manifest: { id: 'agentrig.core-committer', version: '0.1.0' },
          sourceLabel: 'agentrig/agentrig.core-committer@0.1.0',
          trustTier: 'official',
          installability: 'installable',
        },
      ],
    })
  })

  it('fails before materialization when trust enforcement rejects a rig plugin', async () => {
    mocks.assertInstallableTrust.mockImplementation(() => {
      throw new Error('Trust-tier rejection for agentrig.core-committer@0.1.0')
    })

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
    ).rejects.toThrow(/trust-tier rejection/i)

    expect(mocks.materializeResolvedPluginGraph).not.toHaveBeenCalled()
    expect(mocks.preparePluginInstall).not.toHaveBeenCalled()
  })
})
