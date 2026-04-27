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
  buildResolvedPluginInstallMetadataMap: vi.fn(),
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

vi.mock('../../src/lib/plugin-providers', () => ({
  preparePluginInstall: mocks.preparePluginInstall,
  installPreparedPluginProviders: mocks.installPreparedPluginProviders,
  parsePluginProviderSelector: mocks.parsePluginProviderSelector,
  parsePluginInstallScopeSelector: mocks.parsePluginInstallScopeSelector,
}))

vi.mock('../../src/lib/plugin-install-spec', () => ({
  buildResolvedPluginInstallMetadataMap: mocks.buildResolvedPluginInstallMetadataMap,
}))

vi.mock('../../src/lib/trust', () => ({
  assertInstallableTrust: mocks.assertInstallableTrust,
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
      registries: [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }] satisfies RegistryRef[],
    })
    mocks.buildResolvedPluginInstallMetadataMap.mockReturnValue({
      'demo-plugin': {
        specIdentity: {
          kind: 'registry',
          registryAlias: 'agentrig',
          registryUrl: 'https://agentrig.ai/registry',
          pluginId: 'demo-plugin',
          version: '1.2.3',
        },
        registry: {
          registryAlias: 'agentrig',
          registryUrl: 'https://agentrig.ai/registry',
          sourceRepository: 'https://github.com/agentrig/agentrig-registry',
          contractVersion: '1',
          generatedAt: '2026-04-16T11:00:00Z',
          signature: {
            algorithm: 'sha256-json-envelope',
            keyId: 'agentrig-registry',
            signedDigest: 'sha256:registry',
          },
        },
        snapshotDigest: 'sha256:snapshot',
      },
    })
    mocks.resolvePluginGraph.mockResolvedValue({
      requestedPlugin: {
        manifest: { id: 'demo-plugin', name: 'Demo Plugin', version: '1.2.3' },
        source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
        sourceLabel: 'agentrig/demo-plugin@1.2.3',
        trustTier: 'reviewed',
        installability: 'installable',
        registry: { name: 'agentrig', url: 'https://agentrig.ai/registry' },
      },
      resolvedPlugins: [
        {
          manifest: { id: 'dep-plugin', name: 'Dependency Plugin', version: '0.1.0' },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'agentrig/dep-plugin@0.1.0',
          trustTier: 'official',
          installability: 'installable',
          registry: { name: 'agentrig', url: 'https://agentrig.ai/registry' },
        },
        {
          manifest: { id: 'demo-plugin', name: 'Demo Plugin', version: '1.2.3' },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'agentrig/demo-plugin@1.2.3',
          trustTier: 'reviewed',
          installability: 'installable',
          registry: { name: 'agentrig', url: 'https://agentrig.ai/registry' },
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

  it('prepares installs from canonical latest-first registry install refs and cleans up materialized plugins', async () => {
    await run({
      args: {
        provider: 'codex',
        spec: 'agentrig/demo-plugin',
        cwd: '/repo',
        scope: undefined,
        force: false,
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolvePluginGraph).toHaveBeenCalledWith(
      'agentrig/demo-plugin',
      '/repo',
      [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }],
    )
    expect(mocks.assertInstallableTrust).toHaveBeenCalledWith(
      'dep-plugin',
      '0.1.0',
      'official',
      'installable',
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

  it('fails fast when trust enforcement rejects a resolved snapshot', async () => {
    mocks.assertInstallableTrust.mockImplementation(() => {
      throw new Error('Trust-tier rejection for demo-plugin@1.2.3')
    })

    await expect(
      run({
        args: {
          provider: 'codex',
          spec: 'agentrig/demo-plugin@1.2.3',
          cwd: '/repo',
          scope: undefined,
          force: false,
          dryRun: false,
          help: false,
        },
      }),
    ).rejects.toThrow(/trust-tier rejection/i)
    expect(mocks.cleanupMaterializedPlugin).not.toHaveBeenCalled()
  })
})
