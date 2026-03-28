import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import rigCommand from '../../src/commands/rig'
import listCommand from '../../src/commands/rig/list'
import applyCommand from '../../src/commands/rig/apply'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import {
  cleanupMaterializedPack,
  materializeResolvedPackGraph,
  resolvePackGraph,
} from '../../src/lib/plugin-consumer'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../src/lib/plugin-install-ledger'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
  uninstallPluginProviders,
} from '../../src/lib/plugin-providers'
import { determineTrustTier, requiresConfirmation } from '../../src/lib/trust'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/plugin-consumer', () => ({
  resolvePackGraph: vi.fn(),
  materializeResolvedPackGraph: vi.fn(),
  cleanupMaterializedPack: vi.fn(),
}))
vi.mock('../../src/lib/plugin-install-ledger', () => ({
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
}))
vi.mock('../../src/lib/plugin-providers', () => ({
  preparePluginInstall: vi.fn(),
  installPreparedPluginProviders: vi.fn(),
  uninstallPluginProviders: vi.fn(),
  parsePluginProviderSelector: vi.fn((value?: string) => value),
  parsePluginInstallScopeSelector: vi.fn((value?: string) => value ?? 'auto'),
}))
vi.mock('../../src/lib/trust', () => ({
  determineTrustTier: vi.fn(),
  requiresConfirmation: vi.fn(),
}))

describe('command:rig', () => {
  const runRig = rigCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const runList = listCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const runApply = applyCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('shows usage for rig wrapper', async () => {
    await runRig({ args: { help: false } })
  })

  it('lists rigs from config', async () => {
    const cfg: ResolvedConfig = {
      registries: [],
      rigs: {
        core: { packs: ['core'] },
        extra: { extends: ['core'], packs: ['extra'] },
      },
      defaultRig: 'core',
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)

    await runList({ args: { cwd: '/repo', help: false } })
    expect(loadConfig).toHaveBeenCalledWith('/repo')
  })

  it('applies rigs as provider plugins and prunes stale installs', async () => {
    const cfg: ResolvedConfig = {
      registries: [],
      rigs: {
        base: { packs: ['core'] },
        extra: { extends: ['base'], packs: ['extra', 'core'] },
      },
      defaultRig: 'extra',
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }

    vi.mocked(loadConfig).mockResolvedValue(cfg)
    vi.mocked(parsePluginProviderSelector).mockReturnValue('codex')
    vi.mocked(parsePluginInstallScopeSelector).mockReturnValue('workspace')
    vi.mocked(resolvePackGraph)
      .mockResolvedValueOnce({
        requestedPack: {
          meta: {
            name: 'core',
            title: 'Core',
            description: 'Base pack',
            version: '1.0.0',
            files: [],
          },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'registry:official',
          trustTier: 'official',
          registry: { name: 'official', url: 'https://agentrig.ai/registry' },
        },
        resolvedPacks: [
          {
            meta: {
              name: 'core',
              title: 'Core',
              description: 'Base pack',
              version: '1.0.0',
              files: [],
            },
            source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
            sourceLabel: 'registry:official',
            trustTier: 'official',
            registry: { name: 'official', url: 'https://agentrig.ai/registry' },
          },
        ],
      })
      .mockResolvedValueOnce({
        requestedPack: {
          meta: {
            name: 'extra',
            title: 'Extra',
            description: 'Extra pack',
            version: '1.0.0',
            files: [],
          },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'registry:official',
          trustTier: 'official',
          registry: { name: 'official', url: 'https://agentrig.ai/registry' },
        },
        resolvedPacks: [
          {
            meta: {
              name: 'extra',
              title: 'Extra',
              description: 'Extra pack',
              version: '1.0.0',
              files: [],
            },
            source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
            sourceLabel: 'registry:official',
            trustTier: 'official',
            registry: { name: 'official', url: 'https://agentrig.ai/registry' },
          },
        ],
      })
    vi.mocked(determineTrustTier).mockResolvedValue('official')
    vi.mocked(requiresConfirmation).mockReturnValue(false)
    vi.mocked(materializeResolvedPackGraph).mockResolvedValue({
      resolved: {
        meta: {
          name: 'core',
          title: 'Core',
          description: 'Base pack',
          version: '1.0.0',
          files: [],
        },
        source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
        sourceLabel: 'registry:official',
        trustTier: 'official',
      },
      resolvedPacks: [],
      packsRoot: '/tmp/materialized-pack',
      packDir: '/tmp/materialized-pack/core',
    })
    vi.mocked(preparePluginInstall).mockResolvedValue({
      cwd: '/repo',
      cfg: {
        pluginPrefix: 'agentrig-',
        owner: { name: 'Agentrig' },
        providers: {
          claude: {
            marketplaceName: 'agentrig-community',
            metadata: { description: 'd', version: '1.0.0', pluginRoot: './plugins' },
          },
          codex: {
            marketplaceName: 'agentrig-local',
            displayName: 'Agentrig Local',
            category: 'Productivity',
            installationPolicy: 'AVAILABLE',
            authenticationPolicy: 'ON_INSTALL',
            pluginRoot: './plugins',
          },
          cursor: {
            marketplaceName: 'agentrig-marketplace',
            metadata: { description: 'd', version: '1.0.0', pluginRoot: 'plugins' },
          },
        },
      },
      packsRoot: '/tmp/materialized-pack',
      packs: [
        {
          meta: {
            name: 'core',
            title: 'Core',
            description: 'Base pack',
            version: '1.0.0',
            files: [],
          },
          packDir: '/tmp/materialized-pack/core',
          pluginName: 'agentrig-core',
        },
        {
          meta: {
            name: 'extra',
            title: 'Extra',
            description: 'Extra pack',
            version: '1.0.0',
            files: [],
          },
          packDir: '/tmp/materialized-pack/extra',
          pluginName: 'agentrig-extra',
        },
      ],
      baseOut: '/tmp/plugin-out',
      out: undefined,
      clean: true,
      force: false,
      dryRun: false,
      specIdentitiesByPackName: {
        core: {
          kind: 'registry',
          registryUrl: 'https://agentrig.ai/registry',
          packName: 'core',
        },
        extra: {
          kind: 'registry',
          registryUrl: 'https://agentrig.ai/registry',
          packName: 'extra',
        },
      },
      requestedScope: 'workspace',
      providers: [
        {
          provider: 'codex',
          scope: 'workspace',
          preview: {
            provider: 'codex',
            scope: 'workspace',
            locations: ['/repo/plugins/agentrig-core', '/repo/plugins/agentrig-extra'],
            actions: ['copy plugins'],
          },
        },
      ],
      commandRunner: vi.fn(),
      exportOptions: {
        cwd: '/repo',
        agent: 'codex',
        packsDir: '/tmp/materialized-pack',
      },
    } as Awaited<ReturnType<typeof preparePluginInstall>>)
    vi.mocked(installPreparedPluginProviders).mockResolvedValue([
      {
        provider: 'codex',
        scope: 'workspace',
        installed: ['agentrig-core', 'agentrig-extra'],
        skipped: [],
        locations: ['/repo/plugins/agentrig-core', '/repo/plugins/agentrig-extra'],
        ledgerEntries: [],
      },
    ])
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'codex:workspace:agentrig-old',
        provider: 'codex',
        requestedScope: 'workspace',
        specIdentity: {
          kind: 'registry',
          registryUrl: 'https://agentrig.ai/registry',
          packName: 'old',
        },
        scope: 'workspace',
        packName: 'old',
        packVersion: '1.0.0',
        pluginName: 'agentrig-old',
        sourceLocation: '/tmp/agentrig-old',
        targetPaths: ['/repo/plugins/agentrig-old'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          pluginPath: '/repo/plugins/agentrig-old',
          marketplacePath: '/repo/.agents/plugins/marketplace.json',
          marketplaceEntry: {
            name: 'agentrig-old',
            source: { source: 'local', path: './plugins/agentrig-old' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        },
      },
    ])
    vi.mocked(uninstallPluginProviders).mockResolvedValue([
      {
        provider: 'codex',
        removed: ['agentrig-old'],
        kept: [],
        missing: [],
        locations: ['/repo/plugins/agentrig-old'],
        clearedRecordIds: ['codex:workspace:agentrig-old'],
      },
    ])

    await runApply({
      args: {
        provider: 'codex',
        name: 'extra',
        cwd: '/repo',
        scope: 'workspace',
        force: false,
        prune: true,
        dryRun: false,
        help: false,
      },
    })

    expect(resolvePackGraph).toHaveBeenNthCalledWith(1, 'core', '/repo', cfg.registries)
    expect(resolvePackGraph).toHaveBeenNthCalledWith(2, 'extra', '/repo', cfg.registries)
    expect(preparePluginInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo',
        agent: 'codex',
        packsDir: '/tmp/materialized-pack',
        scope: 'workspace',
      })
    )
    expect(uninstallPluginProviders).toHaveBeenCalledWith(
      [expect.objectContaining({ packName: 'old', provider: 'codex' })],
      expect.objectContaining({ cwd: '/repo', dryRun: false })
    )
    expect(cleanupMaterializedPack).toHaveBeenCalledWith('/tmp/materialized-pack')
  })
})
