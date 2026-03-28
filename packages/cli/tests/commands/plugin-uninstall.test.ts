import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/plugin/uninstall'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../src/lib/plugin-install-ledger'
import { resolvePackSpec } from '../../src/lib/pack-resolver'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  uninstallPluginProviders,
} from '../../src/lib/plugin-providers'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/plugin-install-ledger', () => ({
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
}))
vi.mock('../../src/lib/pack-resolver', () => ({
  resolvePackSpec: vi.fn(),
}))
vi.mock('../../src/lib/plugin-providers', () => ({
  parsePluginProviderSelector: vi.fn((value?: string) => value),
  parsePluginInstallScopeSelector: vi.fn((value?: string) => value ?? 'auto'),
  uninstallPluginProviders: vi.fn(),
}))

describe('command:plugin-uninstall', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('uninstalls provider plugins by resolved pack name', async () => {
    const cfg: ResolvedConfig = {
      registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    vi.mocked(parsePluginProviderSelector).mockReturnValue('codex')
    vi.mocked(parsePluginInstallScopeSelector).mockReturnValue('workspace')
    vi.mocked(resolvePackSpec).mockResolvedValue({
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
    })
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'codex:workspace:agentrig-core-committer',
        provider: 'codex',
        requestedScope: 'workspace',
        specIdentity: {
          kind: 'registry',
          registryUrl: 'https://georg.dev/agentrig',
          packName: 'core-committer',
        },
        scope: 'workspace',
        packName: 'core-committer',
        packVersion: '1.0.0',
        pluginName: 'agentrig-core-committer',
        sourceLocation: '/tmp/plugins/agentrig-core-committer',
        targetPaths: ['/repo/plugins/agentrig-core-committer'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          pluginPath: '/repo/plugins/agentrig-core-committer',
          marketplacePath: '/repo/.agents/plugins/marketplace.json',
          marketplaceEntry: {
            name: 'agentrig-core-committer',
            source: { source: 'local', path: './plugins/agentrig-core-committer' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        },
      },
    ])
    vi.mocked(uninstallPluginProviders).mockResolvedValue([
      {
        provider: 'codex',
        removed: ['agentrig-core-committer'],
        kept: [],
        missing: [],
        locations: ['/repo/plugins/agentrig-core-committer'],
        clearedRecordIds: ['codex:workspace:agentrig-core-committer'],
      },
    ])

    await run({
      args: {
        provider: 'codex',
        spec: 'georg/core-committer',
        cwd: '/repo',
        scope: 'workspace',
        dryRun: false,
        help: false,
      },
    })

    expect(resolvePackSpec).toHaveBeenCalledWith('georg/core-committer', '/repo', cfg.registries)
    expect(uninstallPluginProviders).toHaveBeenCalledWith(
      [expect.objectContaining({ packName: 'core-committer', provider: 'codex' })],
      expect.objectContaining({ cwd: '/repo', dryRun: false })
    )
  })

  it('matches a unique registry install from the ledger when alias resolution is unavailable', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    })
    vi.mocked(parsePluginProviderSelector).mockReturnValue('codex')
    vi.mocked(resolvePackSpec).mockRejectedValue(new Error('offline'))
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'codex:workspace:agentrig-core-committer',
        provider: 'codex',
        requestedScope: 'workspace',
        specIdentity: {
          kind: 'registry',
          registryUrl: 'https://georg.dev/agentrig',
          packName: 'core-committer',
        },
        scope: 'workspace',
        packName: 'core-committer',
        packVersion: '1.0.0',
        pluginName: 'agentrig-core-committer',
        sourceLocation: '/tmp/plugins/agentrig-core-committer',
        targetPaths: ['/repo/plugins/agentrig-core-committer'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          pluginPath: '/repo/plugins/agentrig-core-committer',
          marketplacePath: '/repo/.agents/plugins/marketplace.json',
          marketplaceEntry: {
            name: 'agentrig-core-committer',
            source: { source: 'local', path: './plugins/agentrig-core-committer' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        },
      },
    ])
    vi.mocked(uninstallPluginProviders).mockResolvedValue([
      {
        provider: 'codex',
        removed: ['agentrig-core-committer'],
        kept: [],
        missing: [],
        locations: ['/repo/plugins/agentrig-core-committer'],
        clearedRecordIds: ['codex:workspace:agentrig-core-committer'],
      },
    ])

    await run({
      args: {
        provider: 'codex',
        spec: 'georg/core-committer',
        cwd: '/repo',
        dryRun: false,
        help: false,
      },
    })

    expect(uninstallPluginProviders).toHaveBeenCalledWith(
      [expect.objectContaining({ packName: 'core-committer', provider: 'codex' })],
      expect.objectContaining({ cwd: '/repo', dryRun: false })
    )
  })

  it('matches the original requested spec when a local filename does not equal meta.name', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    })
    vi.mocked(parsePluginProviderSelector).mockReturnValue('codex')
    vi.mocked(resolvePackSpec).mockRejectedValue(new Error('offline'))
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'codex:workspace:agentrig-typescript-pack',
        provider: 'codex',
        requestedScope: 'workspace',
        specIdentity: {
          kind: 'file',
          metaPath: '/repo/downloads/meta.json',
        },
        scope: 'workspace',
        packName: 'typescript-pack',
        packVersion: '1.0.0',
        pluginName: 'agentrig-typescript-pack',
        sourceLocation: '/tmp/plugins/agentrig-typescript-pack',
        targetPaths: ['/repo/plugins/agentrig-typescript-pack'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          pluginPath: '/repo/plugins/agentrig-typescript-pack',
          marketplacePath: '/repo/.agents/plugins/marketplace.json',
          marketplaceEntry: {
            name: 'agentrig-typescript-pack',
            source: { source: 'local', path: './plugins/agentrig-typescript-pack' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        },
      },
    ])
    vi.mocked(uninstallPluginProviders).mockResolvedValue([
      {
        provider: 'codex',
        removed: ['agentrig-typescript-pack'],
        kept: [],
        missing: [],
        locations: ['/repo/plugins/agentrig-typescript-pack'],
        clearedRecordIds: ['codex:workspace:agentrig-typescript-pack'],
      },
    ])

    await run({
      args: {
        provider: 'codex',
        spec: './downloads/meta.json',
        cwd: '/repo',
        dryRun: false,
        help: false,
      },
    })

    expect(uninstallPluginProviders).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          packName: 'typescript-pack',
          specIdentity: { kind: 'file', metaPath: '/repo/downloads/meta.json' },
        }),
      ],
      expect.objectContaining({ cwd: '/repo', dryRun: false })
    )
  })
})
