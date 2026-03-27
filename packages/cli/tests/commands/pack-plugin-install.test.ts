import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/pack/plugin-install'
import {
  installPreparedPluginProviders,
  preparePluginInstall,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
} from '../../src/lib/plugin-providers'

vi.mock('../../src/lib/plugin-providers', () => ({
  installPreparedPluginProviders: vi.fn(),
  preparePluginInstall: vi.fn(),
  parsePluginInstallScopeSelector: vi.fn((value?: string) => (value ?? 'auto')),
  parsePluginProviderSelector: vi.fn((value?: string) => value),
}))

describe('command:pack:plugin-install', () => {
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

  it('rejects non-interactive installs without an explicit provider', async () => {
    await expect(
      run({
        args: {
          packsDir: 'registry/packs',
          all: false,
          help: false,
        },
        rawArgs: [],
      })
    ).rejects.toThrow('Non-interactive installs require `--agent <provider>` or `--all`.')
  })

  it('rejects non-interactive installs without an explicit pack or --all', async () => {
    vi.mocked(parsePluginProviderSelector).mockReturnValue('claude')

    await expect(
      run({
        args: {
          agent: 'claude',
          packsDir: 'registry/packs',
          all: false,
          help: false,
        },
        rawArgs: ['--agent', 'claude'],
      })
    ).rejects.toThrow('Non-interactive installs require `--pack <folder>` or `--all`.')
  })

  it('prints a preflight summary before installing', async () => {
    vi.mocked(parsePluginProviderSelector).mockReturnValue('claude')
    vi.mocked(parsePluginInstallScopeSelector).mockReturnValue('auto')
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
      packsRoot: '/repo/registry/packs',
      packs: [
        {
          meta: {
            name: 'sample-pack',
            title: 'Sample Pack',
            description: 'Sample description',
            version: '1.0.0',
            files: [],
          },
          packDir: '/repo/registry/packs/sample-pack',
          pluginName: 'agentrig-sample-pack',
        },
      ],
      baseOut: '/tmp/agentrig-plugins',
      out: undefined,
      clean: true,
      force: false,
      dryRun: false,
      requestedScope: 'auto',
      providers: [
        {
          provider: 'claude',
          scope: 'workspace',
          preview: {
            provider: 'claude',
            scope: 'workspace',
            locations: ['/tmp/agentrig-plugins/claude'],
            actions: ['claude plugin marketplace add /tmp/agentrig-plugins/claude'],
          },
        },
      ],
      commandRunner: vi.fn(),
      exportOptions: {
        cwd: '/repo',
        agent: 'claude',
        packsDir: 'registry/packs',
        pack: 'sample-pack',
      },
    } as Awaited<ReturnType<typeof preparePluginInstall>>)
    vi.mocked(installPreparedPluginProviders).mockResolvedValue([
      {
        provider: 'claude',
        scope: 'workspace',
        installed: ['agentrig-sample-pack'],
        skipped: [],
        locations: ['/tmp/agentrig-plugins/claude'],
        ledgerEntries: [],
      },
    ])

    await run({
      args: {
        agent: 'claude',
        pack: 'sample-pack',
        packsDir: 'registry/packs',
        all: false,
        help: false,
      },
      rawArgs: ['--agent', 'claude', '--pack', 'sample-pack'],
    })

    expect(console.log).toHaveBeenCalledWith('Install plan:')
    expect(console.log).toHaveBeenCalledWith('  packs: sample-pack')
    expect(console.log).toHaveBeenCalledWith('  requested scope: auto')
    expect(console.log).toHaveBeenCalledWith('claude [workspace]')
    expect(console.log).toHaveBeenCalledWith('  -> /tmp/agentrig-plugins/claude')
  })
})
