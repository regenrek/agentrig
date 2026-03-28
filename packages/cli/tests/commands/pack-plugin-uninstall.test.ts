import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/pack/plugin-uninstall'
import {
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  uninstallPluginProviders,
} from '../../src/lib/plugin-providers'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../../src/lib/plugin-install-ledger'

vi.mock('../../src/lib/plugin-providers', () => ({
  parsePluginInstallScopeSelector: vi.fn((value?: string) => (value ?? 'auto')),
  parsePluginProviderSelector: vi.fn((value?: string) => value),
  uninstallPluginProviders: vi.fn(),
}))

vi.mock('../../src/lib/plugin-install-ledger', () => ({
  loadPluginInstallLedgers: vi.fn(),
  listPluginInstallRecords: vi.fn(),
}))

describe('command:pack:plugin-uninstall', () => {
  const run = command.run as (ctx: {
    args: Record<string, unknown>
    rawArgs?: string[]
  }) => Promise<void>
  let stdinIsTTY = true
  let stdoutIsTTY = true

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    stdinIsTTY = Boolean(process.stdin.isTTY)
    stdoutIsTTY = Boolean(process.stdout.isTTY)
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdinIsTTY })
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdoutIsTTY })
  })

  it('prints an uninstall plan and delegates to provider uninstallation', async () => {
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'claude:workspace:agentrig-sample-pack',
        provider: 'claude',
        requestedScope: 'auto',
        scope: 'workspace',
        packName: 'sample-pack',
        packVersion: '1.0.0',
        pluginName: 'agentrig-sample-pack',
        sourceLocation: '/tmp/claude',
        targetPaths: ['/tmp/claude'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          marketplaceName: 'agentrig-community',
          pluginRef: 'agentrig-sample-pack@agentrig-community',
          scopeArg: 'project',
          marketplaceSourcePath: '/tmp/claude',
          marketplaceAdded: true,
        },
      },
    ])
    vi.mocked(parsePluginProviderSelector).mockReturnValue('claude')
    vi.mocked(parsePluginInstallScopeSelector).mockReturnValue('workspace')
    vi.mocked(uninstallPluginProviders).mockResolvedValue([
      {
        provider: 'claude',
        removed: ['agentrig-sample-pack'],
        kept: [],
        missing: [],
        locations: ['/tmp/claude'],
        clearedRecordIds: ['claude:workspace:agentrig-sample-pack'],
      },
    ])

    await run({
      args: {
        agent: 'claude',
        pack: 'sample-pack',
        scope: 'workspace',
        all: false,
        help: false,
      },
      rawArgs: ['--agent', 'claude', '--pack', 'sample-pack', '--scope', 'workspace'],
    })

    expect(console.log).toHaveBeenCalledWith('Uninstall plan:')
    expect(console.log).toHaveBeenCalledWith('  providers: claude')
    expect(console.log).toHaveBeenCalledWith('  scopes: workspace')
    expect(console.log).toHaveBeenCalledWith('  packs: sample-pack')
    expect(uninstallPluginProviders).toHaveBeenCalled()
  })

  it('allows non-interactive mixed-scope uninstall when --all is passed', async () => {
    vi.mocked(loadPluginInstallLedgers).mockResolvedValue({
      personal: { schemaVersion: 1, installs: {} },
      workspace: { schemaVersion: 1, installs: {} },
    })
    vi.mocked(listPluginInstallRecords).mockReturnValue([
      {
        id: 'claude:personal:agentrig-sample-pack',
        provider: 'claude',
        requestedScope: 'auto',
        scope: 'personal',
        packName: 'sample-pack',
        packVersion: '1.0.0',
        pluginName: 'agentrig-sample-pack',
        sourceLocation: '/tmp/personal',
        targetPaths: ['/tmp/personal'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          marketplaceName: 'agentrig-community',
          pluginRef: 'agentrig-sample-pack@agentrig-community',
          scopeArg: 'user',
          marketplaceSourcePath: '/tmp/personal',
          marketplaceAdded: true,
        },
      },
      {
        id: 'claude:workspace:agentrig-sample-pack',
        provider: 'claude',
        requestedScope: 'auto',
        scope: 'workspace',
        packName: 'sample-pack',
        packVersion: '1.0.0',
        pluginName: 'agentrig-sample-pack',
        sourceLocation: '/tmp/workspace',
        targetPaths: ['/tmp/workspace'],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          marketplaceName: 'agentrig-community',
          pluginRef: 'agentrig-sample-pack@agentrig-community',
          scopeArg: 'project',
          marketplaceSourcePath: '/tmp/workspace',
          marketplaceAdded: true,
        },
      },
    ])
    vi.mocked(uninstallPluginProviders).mockResolvedValue([
      {
        provider: 'claude',
        removed: ['agentrig-sample-pack'],
        kept: [],
        missing: [],
        locations: ['/tmp/personal', '/tmp/workspace'],
        clearedRecordIds: [
          'claude:personal:agentrig-sample-pack',
          'claude:workspace:agentrig-sample-pack',
        ],
      },
    ])

    await expect(
      run({
        args: {
          all: true,
          help: false,
        },
        rawArgs: ['--all'],
      })
    ).resolves.toBeUndefined()

    expect(uninstallPluginProviders).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'personal' }),
        expect.objectContaining({ scope: 'workspace' }),
      ]),
      expect.objectContaining({
        cwd: process.cwd(),
      })
    )
  })
})
