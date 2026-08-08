import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
  listSelectionInstallRecords: vi.fn(),
  uninstallSelectionInstallRecords: vi.fn(),
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
  listSelectionInstallRecords: mocks.listSelectionInstallRecords,
}))

vi.mock('../../src/lib/artifact-selection-install', () => ({
  uninstallSelectionInstallRecords: mocks.uninstallSelectionInstallRecords,
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
    mocks.listSelectionInstallRecords.mockReturnValue([])
    mocks.uninstallSelectionInstallRecords.mockResolvedValue({
      removed: [],
      kept: [],
      missing: [],
      clearedRecordIds: [],
    })
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

  it('matches AgentRig-managed external-repo installs by plugin id without registry resolution', async () => {
    mocks.listPluginInstallRecords.mockReturnValue([
      {
        provider: 'cursor',
        scope: 'personal',
        pluginId: 'external.skills',
        pluginName: 'agentrig-external.skills',
        targetPaths: ['/sandbox/.cursor/plugins/local/agentrig-external.skills'],
        specIdentity: {
          kind: 'external-repo',
          repoUrl: 'https://github.com/anthropics/skills',
          owner: 'anthropics',
          repo: 'skills',
          commitSha: 'd230a6dd6eb1a0dbee9fec55e2f00a96e28dff81',
          scanDigest: 'abc123',
          pickedSignalPaths: ['skills/doc-coauthoring'],
          pluginId: 'external.skills',
          version: '0.1.0',
        },
      },
    ])

    await run({
      args: {
        provider: 'cursor',
        spec: 'external.skills',
        cwd: '/sandbox/workspace',
        scope: undefined,
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolvePluginInstallSpecIdentity).not.toHaveBeenCalled()
    expect(mocks.uninstallPluginProviders).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          pluginId: 'external.skills',
          pluginName: 'agentrig-external.skills',
        }),
      ],
      { cwd: '/sandbox/workspace', dryRun: false },
    )
  })

  it('uninstalls external-repo Selection records by generated plugin id', async () => {
    const selection = {
      id: 'selection:cursor:personal:sha256:test',
      provider: 'cursor',
      scope: 'personal',
      pluginId: 'external.skills',
      selectedSelectors: ['skill:doc-coauthoring'],
      targetPaths: ['/sandbox/.cursor/skills/doc-coauthoring/SKILL.md'],
      specIdentity: {
        kind: 'external-repo',
        repoUrl: 'https://github.com/anthropics/skills',
        scanDigest: 'abc123',
        pickedSignalPaths: ['skills/doc-coauthoring'],
        pluginId: 'external.skills',
        version: '0.1.0',
      },
    }
    mocks.listPluginInstallRecords.mockReturnValue([])
    mocks.listSelectionInstallRecords.mockReturnValue([selection])

    await run({
      args: {
        provider: 'cursor',
        spec: 'external.skills',
        cwd: '/sandbox/workspace',
        scope: 'personal',
        dryRun: false,
        help: false,
      },
    })

    expect(mocks.resolvePluginInstallSpecIdentity).not.toHaveBeenCalled()
    expect(mocks.uninstallSelectionInstallRecords).toHaveBeenCalledWith({
      cwd: '/sandbox/workspace',
      records: [selection],
      dryRun: false,
    })
    expect(mocks.uninstallPluginProviders).not.toHaveBeenCalled()
  })
})
