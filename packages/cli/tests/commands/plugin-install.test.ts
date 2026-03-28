import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/plugin/install'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import {
  cleanupMaterializedPack,
  materializeResolvedPackGraph,
  resolvePackGraph,
} from '../../src/lib/plugin-consumer'
import {
  installPreparedPluginProviders,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  preparePluginInstall,
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
vi.mock('../../src/lib/plugin-providers', () => ({
  preparePluginInstall: vi.fn(),
  installPreparedPluginProviders: vi.fn(),
  parsePluginProviderSelector: vi.fn((value?: string) => value),
  parsePluginInstallScopeSelector: vi.fn((value?: string) => value ?? 'auto'),
}))
vi.mock('../../src/lib/trust', () => ({
  determineTrustTier: vi.fn(),
  requiresConfirmation: vi.fn(),
}))

describe('command:plugin-install', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('installs a resolved pack into a single provider', async () => {
    const cfg: ResolvedConfig = {
      registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    vi.mocked(resolvePackGraph).mockResolvedValue({
      requestedPack: {
        meta: {
          name: 'core-committer',
          title: 'Core Committer',
          description: 'Commit helper',
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
            name: 'core-committer',
            title: 'Core Committer',
            description: 'Commit helper',
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
          name: 'core-committer',
          title: 'Core Committer',
          description: 'Commit helper',
          version: '1.0.0',
          files: [],
        },
        source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
        sourceLabel: 'registry:official',
        trustTier: 'official',
        registry: { name: 'official', url: 'https://agentrig.ai/registry' },
      },
      resolvedPacks: [],
      packsRoot: '/tmp/materialized-pack',
      packDir: '/tmp/materialized-pack/core-committer',
    })
    vi.mocked(parsePluginProviderSelector).mockReturnValue('codex')
    vi.mocked(parsePluginInstallScopeSelector).mockReturnValue('workspace')
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
            name: 'core-committer',
            title: 'Core Committer',
            description: 'Commit helper',
            version: '1.0.0',
            files: [],
          },
          packDir: '/tmp/materialized-pack/core-committer',
          pluginName: 'agentrig-core-committer',
        },
      ],
      baseOut: '/tmp/plugin-out',
      out: undefined,
      clean: true,
      force: false,
      dryRun: false,
      specIdentitiesByPackName: {
        'core-committer': {
          kind: 'registry',
          registryUrl: 'https://agentrig.ai/registry',
          packName: 'core-committer',
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
            locations: ['/repo/plugins/agentrig-core-committer'],
            actions: ['copy agentrig-core-committer -> /repo/plugins/agentrig-core-committer'],
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
        installed: ['agentrig-core-committer'],
        skipped: [],
        locations: ['/repo/plugins/agentrig-core-committer'],
        ledgerEntries: [],
      },
    ])

    await run({
      args: {
        provider: 'codex',
        spec: 'core-committer',
        cwd: '/repo',
        scope: 'workspace',
        force: false,
        dryRun: false,
        help: false,
      },
    })

    expect(resolvePackGraph).toHaveBeenCalledWith('core-committer', '/repo', cfg.registries)
    expect(preparePluginInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo',
        agent: 'codex',
        packsDir: '/tmp/materialized-pack',
        specIdentitiesByPackName: {
          'core-committer': {
            kind: 'registry',
            registryUrl: 'https://agentrig.ai/registry',
            packName: 'core-committer',
          },
        },
        scope: 'workspace',
      })
    )
    expect(cleanupMaterializedPack).toHaveBeenCalledWith('/tmp/materialized-pack')
  })
})
