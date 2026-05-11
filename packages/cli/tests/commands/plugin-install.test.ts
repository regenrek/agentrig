import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { savePluginInstallLedger } from '../../src/lib/plugin-install-ledger'
import type { PluginInstallRecord, RegistryRef } from '../../src/lib/types'

const tempDirs: string[] = []

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
  const run = command.run as (ctx: { args: Record<string, unknown>, rawArgs?: string[] }) => Promise<void>

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

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('rejects codex workspace scope before registry resolution or bundle materialization', async () => {
    mocks.parsePluginInstallScopeSelector.mockReturnValueOnce('workspace')

    await expect(run({
      rawArgs: [
        'codex',
        'agentrig/demo-plugin',
        '--scope',
        'workspace',
        '--force',
      ],
      args: {
        provider: 'codex',
        spec: 'agentrig/demo-plugin',
        cwd: '/repo',
        scope: 'workspace',
        force: true,
        dryRun: false,
        help: false,
      },
    })).rejects.toThrow(/Codex plugins only support --scope personal/)

    expect(mocks.loadConfig).not.toHaveBeenCalled()
    expect(mocks.resolvePluginGraph).not.toHaveBeenCalled()
    expect(mocks.materializeResolvedPluginGraph).not.toHaveBeenCalled()
    expect(mocks.preparePluginInstall).not.toHaveBeenCalled()
    expect(mocks.installPreparedPluginProviders).not.toHaveBeenCalled()
    expect(mocks.cleanupMaterializedPlugin).not.toHaveBeenCalled()
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

  it('returns before resolving the install graph when the plugin is already installed without --force', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agentrig-plugin-install-test-'))
    tempDirs.push(root)
    const cwd = path.join(root, 'workspace')
    const installPath = path.join(cwd, '.codex', 'plugins', 'cache', 'agentrig-local', 'demo-plugin', '1.2.3')
    await mkdir(installPath, { recursive: true })
    await writeFile(path.join(installPath, 'marker.txt'), 'installed')
    const record: PluginInstallRecord = {
      id: 'codex:personal:demo-plugin',
      provider: 'codex',
      requestedScope: 'auto',
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
      scope: 'personal',
      pluginId: 'demo-plugin',
      pluginVersion: '1.2.3',
      snapshotDigest: 'sha256:snapshot',
      pluginName: 'demo-plugin',
      targetPaths: [installPath],
      installedAt: '2026-05-10T17:59:54.123Z',
      files: [],
      metadata: {
        pluginPath: installPath,
        marketplacePath: path.join(cwd, '.agentrig', 'cache', 'codex-marketplaces', 'agentrig-local', '.agents', 'plugins', 'marketplace.json'),
        marketplaceName: 'agentrig-local',
        pluginRef: 'demo-plugin@agentrig-local',
        appServerInstalled: true,
        marketplaceEntry: {
          name: 'demo-plugin',
          source: { source: 'local', path: './plugins/demo-plugin' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'productivity',
        },
      },
    }
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 3,
      installs: { [record.id]: record },
      selections: {},
    })

    await expect(run({
      args: {
        provider: 'codex',
        spec: 'agentrig/demo-plugin',
        cwd,
        scope: undefined,
        force: false,
        dryRun: false,
        help: false,
      },
    })).resolves.toBeUndefined()

    expect(console.log).toHaveBeenCalledWith(
      `Already installed: demo-plugin@1.2.3 (codex, personal) at ${installPath}.`
    )
    expect(console.log).toHaveBeenCalledWith('Use --force to reinstall.')
    expect(mocks.loadConfig).not.toHaveBeenCalled()
    expect(mocks.resolvePluginGraph).not.toHaveBeenCalled()
    expect(mocks.materializeResolvedPluginGraph).not.toHaveBeenCalled()
  })

  it('fails fast when materialization rejects a resolved install bundle', async () => {
    mocks.materializeResolvedPluginGraph.mockRejectedValueOnce(new Error('sha256_mismatch'))

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
    ).rejects.toThrow(/sha256_mismatch/i)
    expect(mocks.cleanupMaterializedPlugin).not.toHaveBeenCalled()
  })

  it('plumbs --no-enable to provider install planning', async () => {
    await run({
      rawArgs: [
        'codex',
        'agentrig/demo-plugin',
        '--cwd',
        '/repo',
        '--no-enable',
      ],
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

    expect(mocks.preparePluginInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        enable: false,
      }),
    )
  })
})
