import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegistryRef } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolvePluginGraph: vi.fn(),
  materializeResolvedPluginGraph: vi.fn(),
  materializeResolvedStandaloneArtifact: vi.fn(),
  cleanupMaterializedPlugin: vi.fn(),
  parsePluginProviderSelector: vi.fn(),
  parsePluginInstallScopeSelector: vi.fn(),
  resolveInstallScope: vi.fn(),
  resolveStandaloneArtifact: vi.fn(),
  installArtifactSelection: vi.fn(),
  uninstallArtifactSelection: vi.fn(),
  assertInstallableTrust: vi.fn(),
}))

vi.mock('../../src/lib/config', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../../src/lib/plugin-consumer', () => ({
  resolvePluginGraph: mocks.resolvePluginGraph,
  materializeResolvedPluginGraph: mocks.materializeResolvedPluginGraph,
  materializeResolvedStandaloneArtifact: mocks.materializeResolvedStandaloneArtifact,
  cleanupMaterializedPlugin: mocks.cleanupMaterializedPlugin,
}))

vi.mock('../../src/lib/plugin-providers', () => ({
  parsePluginProviderSelector: mocks.parsePluginProviderSelector,
  parsePluginInstallScopeSelector: mocks.parsePluginInstallScopeSelector,
  resolveInstallScope: mocks.resolveInstallScope,
}))

vi.mock('../../src/lib/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/lib/registry')>(),
  resolveStandaloneArtifact: mocks.resolveStandaloneArtifact,
}))

vi.mock('../../src/lib/artifact-selection-install', () => ({
  installArtifactSelection: mocks.installArtifactSelection,
  uninstallArtifactSelection: mocks.uninstallArtifactSelection,
}))

vi.mock('../../src/lib/trust', () => ({
  assertInstallableTrust: mocks.assertInstallableTrust,
}))

import { createArtifactKindCommand } from '../../src/commands/artifact-kind-install'

describe('command:artifact install', () => {
  const command = createArtifactKindCommand('skill')
  const install = (command.subCommands as Record<string, { run?: unknown }>).install
  const uninstall = (command.subCommands as Record<string, { run?: unknown }>).uninstall
  const run = install?.run as (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>
  const runUninstall = uninstall?.run as (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.parsePluginProviderSelector.mockReturnValue('codex')
    mocks.parsePluginInstallScopeSelector.mockReturnValue('auto')
    mocks.resolveInstallScope.mockReturnValue('workspace')
    mocks.loadConfig.mockResolvedValue({
      registries: [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }] satisfies RegistryRef[],
    })
    mocks.resolveStandaloneArtifact.mockResolvedValue({
      artifactKind: 'skill',
      artifactId: 'demo.review',
      manifest: { id: 'demo.review', version: '1.0.0' },
      trustTier: 'reviewed',
      installability: 'installable',
    })
    mocks.materializeResolvedStandaloneArtifact.mockResolvedValue({
      artifactsRoot: '/tmp/artifacts',
      artifactDir: '/tmp/artifacts/demo.review',
    })
    mocks.resolvePluginGraph.mockResolvedValue({
      requestedPlugin: {
        manifest: { id: 'demo.plugin', version: '1.0.0' },
        trustTier: 'reviewed',
        installability: 'installable',
      },
      resolvedPlugins: [
        {
          manifest: { id: 'demo.plugin', version: '1.0.0' },
          trustTier: 'reviewed',
          installability: 'installable',
        },
      ],
    })
    mocks.materializeResolvedPluginGraph.mockResolvedValue({
      pluginsRoot: '/tmp/plugins',
      pluginDir: '/tmp/plugins/demo.plugin',
    })
    mocks.installArtifactSelection.mockResolvedValue({
      bundle: { selectionId: 'selection-id', materialization: { warnings: [] } },
      record: {
        selectedSelectors: ['skill:review'],
        targetPaths: ['/repo/.codex/skills/review/SKILL.md'],
      },
    })
    mocks.uninstallArtifactSelection.mockResolvedValue({
      removed: ['/repo/.codex/skills/review/SKILL.md'],
      kept: [],
      missing: [],
      clearedRecordIds: ['selection:codex:workspace:selection-id'],
    })
  })

  it('installs standalone skill refs without resolving a plugin graph', async () => {
    await run({
      args: {
        provider: 'codex',
        source: 'agentrig/demo.review',
        pick: undefined,
        cwd: '/repo',
        scope: undefined,
        force: false,
        dryRun: false,
        help: false,
      },
      rawArgs: [],
    })

    expect(mocks.resolveStandaloneArtifact).toHaveBeenCalledWith(
      'agentrig',
      'skill',
      'demo.review',
      undefined,
      [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }],
    )
    expect(mocks.resolvePluginGraph).not.toHaveBeenCalled()
    expect(mocks.installArtifactSelection).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'registry-artifact',
      registryRef: 'agentrig/demo.review',
      pluginDir: '/tmp/artifacts/demo.review',
    }))
    expect(mocks.cleanupMaterializedPlugin).toHaveBeenCalledWith('/tmp/artifacts')
  })

  it('keeps plugin --pick flow on the existing plugin resolver path', async () => {
    await run({
      args: {
        provider: 'codex',
        source: 'agentrig/demo.plugin',
        pick: 'review',
        cwd: '/repo',
        scope: undefined,
        force: false,
        dryRun: false,
        help: false,
      },
      rawArgs: ['--pick', 'review'],
    })

    expect(mocks.resolveStandaloneArtifact).not.toHaveBeenCalled()
    expect(mocks.resolvePluginGraph).toHaveBeenCalledWith(
      'agentrig/demo.plugin',
      '/repo',
      [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }],
    )
    expect(mocks.materializeResolvedPluginGraph).toHaveBeenCalledTimes(1)
    expect(mocks.installArtifactSelection).toHaveBeenCalledWith(expect.objectContaining({
      registryRef: 'agentrig/demo.plugin',
      picks: ['review'],
      defaultKind: 'skill',
      pluginDir: '/tmp/plugins/demo.plugin',
    }))
    expect(mocks.cleanupMaterializedPlugin).toHaveBeenCalledWith('/tmp/plugins')
  })

  it('uninstalls standalone skill refs without --pick', async () => {
    await runUninstall({
      args: {
        provider: 'codex',
        source: 'agentrig/demo.review',
        pick: undefined,
        cwd: '/repo',
        scope: undefined,
        dryRun: false,
        help: false,
      },
      rawArgs: [],
    })

    expect(mocks.uninstallArtifactSelection).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'registry-artifact',
      source: 'agentrig/demo.review',
      picks: [],
      defaultKind: 'skill',
      provider: 'codex',
      cwd: '/repo',
    }))
  })

  it('keeps plugin --pick uninstall on the existing plugin selection path', async () => {
    await runUninstall({
      args: {
        provider: 'codex',
        source: 'agentrig/demo.plugin',
        pick: 'review',
        cwd: '/repo',
        scope: undefined,
        dryRun: false,
        help: false,
      },
      rawArgs: ['--pick', 'review'],
    })

    expect(mocks.uninstallArtifactSelection).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'registry-plugin',
      source: 'agentrig/demo.plugin',
      picks: ['review'],
      defaultKind: 'skill',
      provider: 'codex',
      cwd: '/repo',
    }))
  })

  it('continues to block no-pick standalone mcp uninstall', async () => {
    const mcpCommand = createArtifactKindCommand('mcp')
    const mcpUninstall = (mcpCommand.subCommands as Record<string, { run?: unknown }>).uninstall
    const runMcpUninstall = mcpUninstall?.run as (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>

    await expect(runMcpUninstall({
      args: {
        provider: 'codex',
        source: 'agentrig/demo.mcp@1.0.0',
        pick: undefined,
        cwd: '/repo',
        scope: undefined,
        dryRun: false,
        help: false,
      },
      rawArgs: [],
    })).rejects.toThrow('mcp uninstall requires at least one --pick value.')
    expect(mocks.uninstallArtifactSelection).not.toHaveBeenCalled()
  })
})
