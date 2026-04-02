import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { RegistryRef } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolvePluginGraph: vi.fn(),
  materializeResolvedPluginGraph: vi.fn(),
  cleanupMaterializedPlugin: vi.fn(),
  preparePluginInstall: vi.fn(),
  installPreparedPluginProviders: vi.fn(),
  parsePluginProviderSelector: vi.fn(),
  parsePluginInstallScopeSelector: vi.fn(),
  buildResolvedPluginSpecIdentityMap: vi.fn(),
  determineTrustTier: vi.fn(),
  requiresConfirmation: vi.fn(),
}))

vi.mock('../../src/lib/config', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../../src/lib/plugin-consumer', () => ({
  resolvePluginGraph: mocks.resolvePluginGraph,
  materializeResolvedPluginGraph: mocks.materializeResolvedPluginGraph,
  cleanupMaterializedPlugin: mocks.cleanupMaterializedPlugin,
}))

vi.mock('../../src/lib/plugin-providers', () => ({
  preparePluginInstall: mocks.preparePluginInstall,
  installPreparedPluginProviders: mocks.installPreparedPluginProviders,
  parsePluginProviderSelector: mocks.parsePluginProviderSelector,
  parsePluginInstallScopeSelector: mocks.parsePluginInstallScopeSelector,
}))

vi.mock('../../src/lib/plugin-install-spec', () => ({
  buildResolvedPluginSpecIdentityMap: mocks.buildResolvedPluginSpecIdentityMap,
}))

vi.mock('../../src/lib/trust', () => ({
  determineTrustTier: mocks.determineTrustTier,
  requiresConfirmation: mocks.requiresConfirmation,
}))

import command from '../../src/commands/plugin/install'

describe('command:plugin install', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.parsePluginProviderSelector.mockReturnValue('codex')
    mocks.parsePluginInstallScopeSelector.mockReturnValue('auto')
    mocks.loadConfig.mockResolvedValue({
      registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }] satisfies RegistryRef[],
    })
    mocks.determineTrustTier.mockResolvedValue('official')
    mocks.requiresConfirmation.mockReturnValue(false)
    mocks.buildResolvedPluginSpecIdentityMap.mockReturnValue(
      new Map([['demo-plugin', { kind: 'registry', registryUrl: 'https://agentrig.ai/registry', pluginId: 'demo-plugin' }]])
    )
    mocks.resolvePluginGraph.mockResolvedValue({
      requestedPlugin: {
        manifest: { id: 'demo-plugin', name: 'Demo Plugin' },
        source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
        sourceLabel: 'registry:official',
        trustTier: 'official',
        registry: { name: 'official', url: 'https://agentrig.ai/registry' },
      },
      resolvedPlugins: [
        {
          manifest: { id: 'dep-plugin', name: 'Dependency Plugin' },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'registry:official',
          trustTier: 'official',
          registry: { name: 'official', url: 'https://agentrig.ai/registry' },
        },
        {
          manifest: { id: 'demo-plugin', name: 'Demo Plugin' },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'registry:official',
          trustTier: 'official',
          registry: { name: 'official', url: 'https://agentrig.ai/registry' },
        },
      ],
    })
    mocks.materializeResolvedPluginGraph.mockResolvedValue({
      pluginsRoot: '/tmp/materialized-plugins',
      pluginDir: '/tmp/materialized-plugins/demo-plugin',
    })
    mocks.preparePluginInstall.mockResolvedValue({
      plugins: [
        { manifest: { id: 'dep-plugin' } },
        { manifest: { id: 'demo-plugin' } },
      ],
      requestedScope: 'auto',
      providers: [
        {
          provider: 'codex',
          scope: 'workspace',
          preview: {
            locations: ['/tmp/materialized-plugins/demo-plugin'],
            actions: ['write marketplace'],
          },
        },
      ],
    })
    mocks.installPreparedPluginProviders.mockResolvedValue([
      {
        provider: 'codex',
        scope: 'workspace',
        installed: ['demo-plugin'],
        skipped: [],
        locations: ['/tmp/materialized-plugins/demo-plugin'],
      },
    ])
  })

  it('prepares installs from canonical plugin ids and cleans up materialized plugins', async () => {
    await run({
      args: {
        provider: 'codex',
        spec: 'demo-plugin',
        cwd: '/repo',
        scope: undefined,
        force: false,
        dryRun: false,
        yes: false,
        help: false,
      },
    })

    expect(mocks.resolvePluginGraph).toHaveBeenCalledWith(
      'demo-plugin',
      '/repo',
      [{ name: 'official', url: 'https://agentrig.ai/registry' }],
    )
    expect(mocks.preparePluginInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo',
        agent: 'codex',
        pluginsDir: '/tmp/materialized-plugins',
      }),
    )
    expect(mocks.installPreparedPluginProviders).toHaveBeenCalledTimes(1)
    expect(mocks.cleanupMaterializedPlugin).toHaveBeenCalledWith('/tmp/materialized-plugins')
  })

  it('requires explicit confirmation for unlisted sources', async () => {
    mocks.determineTrustTier.mockResolvedValue('unlisted')
    mocks.requiresConfirmation.mockReturnValue(true)

    await expect(
      run({
        args: {
          provider: 'codex',
          spec: 'demo-plugin',
          cwd: '/repo',
          scope: undefined,
          force: false,
          dryRun: false,
          yes: false,
          help: false,
        },
      }),
    ).rejects.toThrow(/unlisted sources/i)
    expect(mocks.cleanupMaterializedPlugin).not.toHaveBeenCalled()
  })
})
