import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  exportPluginProviders,
  installPluginProviders,
  uninstallPluginProviders,
  type ExternalCommandRunner,
} from '../../src/lib/plugin-providers'
import { loadPluginInstallLedgers } from '../../src/lib/plugin-install-ledger'

type TempWorkspace = {
  rootDir: string
  packsRoot: string
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

async function writeText(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf-8')
}

async function createWorkspace(): Promise<TempWorkspace> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-providers-'))
  const packsRoot = path.join(rootDir, 'packs')
  const packDir = path.join(packsRoot, 'sample-pack')

  await writeJson(path.join(packDir, 'meta.json'), {
    name: 'sample-pack',
    title: 'Sample Pack',
    description: 'Sample description',
    version: '1.0.0',
    author: 'Example Team',
    tags: ['demo'],
  })
  await writeText(path.join(packDir, 'README.md'), '# Sample Pack\n')
  await writeText(
    path.join(packDir, 'skills', 'reviewer', 'SKILL.md'),
    '---\nname: reviewer\ndescription: Review code\n---\nReview code carefully.\n'
  )
  await writeText(path.join(packDir, 'commands', 'deploy.md'), 'Deploy command\n')
  await writeText(path.join(packDir, 'agents', 'reviewer.md'), 'Reviewer agent\n')
  await writeText(
    path.join(packDir, 'hooks', 'hooks.json'),
    '{ "hooks": { "PostToolUse": [] } }\n'
  )
  await writeText(
    path.join(packDir, 'rules', 'prefer-const.mdc'),
    '---\ndescription: Prefer const\nalwaysApply: true\n---\nUse const.\n'
  )
  await writeText(path.join(packDir, '.mcp.json'), '{ "mcpServers": { "demo": { "command": "demo" } } }\n')
  await writeText(path.join(packDir, '.app.json'), '{ "apps": [] }\n')

  return { rootDir, packsRoot }
}

describe('plugin providers', () => {
  let workspace: TempWorkspace | null = null
  let originalHome = ''

  beforeEach(() => {
    originalHome = process.env.HOME || ''
  })

  afterEach(async () => {
    if (workspace) {
      await fs.rm(workspace.rootDir, { recursive: true, force: true })
      workspace = null
    }
    process.env.HOME = originalHome
  })

  it('exports all provider marketplace layouts', async () => {
    workspace = await createWorkspace()
    const outRoot = path.join(workspace.rootDir, 'dist')

    const results = await exportPluginProviders({
      cwd: workspace.rootDir,
      agent: 'all',
      packsDir: workspace.packsRoot,
      out: outRoot,
      clean: true,
    })

    expect(results.map((result) => result.provider)).toEqual(['claude', 'codex', 'cursor'])

    const claudePluginManifest = JSON.parse(
      await fs.readFile(
        path.join(outRoot, 'claude', 'plugins', 'agentrig-sample-pack', '.claude-plugin', 'plugin.json'),
        'utf-8'
      )
    )
    expect(claudePluginManifest.name).toBe('agentrig-sample-pack')
    expect(claudePluginManifest.commands).toEqual(['./commands'])
    expect(claudePluginManifest.agents).toEqual(['./agents'])

    const codexPluginManifest = JSON.parse(
      await fs.readFile(
        path.join(outRoot, 'codex', 'plugins', 'agentrig-sample-pack', '.codex-plugin', 'plugin.json'),
        'utf-8'
      )
    )
    expect(codexPluginManifest.skills).toBe('./skills/')
    expect(codexPluginManifest.mcpServers).toBe('./.mcp.json')
    expect(codexPluginManifest.apps).toBe('./.app.json')

    const codexMarketplace = JSON.parse(
      await fs.readFile(path.join(outRoot, 'codex', '.agents', 'plugins', 'marketplace.json'), 'utf-8')
    )
    expect(codexMarketplace.plugins[0].source.path).toBe('./plugins/agentrig-sample-pack')

    const cursorPluginManifest = JSON.parse(
      await fs.readFile(
        path.join(outRoot, 'cursor', 'plugins', 'agentrig-sample-pack', '.cursor-plugin', 'plugin.json'),
        'utf-8'
      )
    )
    expect(cursorPluginManifest.rules).toBe('./rules')
    expect(cursorPluginManifest.skills).toBe('./skills')
    expect(cursorPluginManifest.mcpServers).toBe('./mcp.json')

    const cursorMcpFile = await fs.readFile(
      path.join(outRoot, 'cursor', 'plugins', 'agentrig-sample-pack', 'mcp.json'),
      'utf-8'
    )
    expect(cursorMcpFile).toContain('"mcpServers"')

    const cursorMarketplace = JSON.parse(
      await fs.readFile(path.join(outRoot, 'cursor', '.cursor-plugin', 'marketplace.json'), 'utf-8')
    )
    expect(cursorMarketplace.plugins[0].source).toBe('plugins/agentrig-sample-pack')
  })

  it('installs providers using provider-specific flows', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    const calls: Array<{ command: string; args: string[] }> = []
    const runner: ExternalCommandRunner = async (command, args) => {
      calls.push({ command, args })
    }

    const results = await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'all',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'personal',
      force: true,
      clean: true,
      commandRunner: runner,
    })

    expect(results.map((result) => result.provider)).toEqual(['claude', 'codex', 'cursor'])
    expect(calls).toEqual([
      {
        command: 'claude',
        args: ['plugin', 'marketplace', 'add', path.join(workspace.rootDir, 'generated', 'claude')],
      },
      {
        command: 'claude',
        args: ['plugin', 'install', 'agentrig-sample-pack@agentrig-community', '--scope', 'user'],
      },
    ])

    const codexPluginPath = path.join(fakeHome, '.codex', 'plugins', 'agentrig-sample-pack', '.codex-plugin', 'plugin.json')
    const codexPluginManifest = JSON.parse(await fs.readFile(codexPluginPath, 'utf-8'))
    expect(codexPluginManifest.name).toBe('agentrig-sample-pack')

    const codexMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json')
    const codexMarketplace = JSON.parse(await fs.readFile(codexMarketplacePath, 'utf-8'))
    expect(codexMarketplace.plugins[0].source.path).toBe('./.codex/plugins/agentrig-sample-pack')

    const cursorPluginPath = path.join(fakeHome, '.cursor', 'plugins', 'local', 'agentrig-sample-pack', '.cursor-plugin', 'plugin.json')
    const cursorPluginManifest = JSON.parse(await fs.readFile(cursorPluginPath, 'utf-8'))
    expect(cursorPluginManifest.name).toBe('agentrig-sample-pack')

    const ledgers = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgers.personal.installs)).toHaveLength(3)
    expect(Object.keys(ledgers.workspace.installs)).toHaveLength(0)
  })

  it('records workspace installs in the workspace ledger', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'codex',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'workspace',
      force: true,
      clean: true,
    })

    const ledgers = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgers.personal.installs)).toHaveLength(0)
    expect(Object.keys(ledgers.workspace.installs)).toEqual(['codex:workspace:agentrig-sample-pack'])
  })

  it('installs Cursor workspace plugins into the repo-local convention and records the workspace ledger', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'cursor',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'workspace',
      force: true,
      clean: true,
    })

    const cursorPluginPath = path.join(
      workspace.rootDir,
      '.cursor',
      'plugins',
      'local',
      'agentrig-sample-pack',
      '.cursor-plugin',
      'plugin.json'
    )
    const cursorPluginManifest = JSON.parse(await fs.readFile(cursorPluginPath, 'utf-8'))
    expect(cursorPluginManifest.name).toBe('agentrig-sample-pack')

    const ledgers = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgers.personal.installs)).toHaveLength(0)
    expect(Object.keys(ledgers.workspace.installs)).toEqual(['cursor:workspace:agentrig-sample-pack'])

    const cursorRecord = ledgers.workspace.installs['cursor:workspace:agentrig-sample-pack']
    expect(cursorRecord?.provider).toBe('cursor')
    if (!cursorRecord || cursorRecord.provider !== 'cursor') {
      throw new Error('Expected a Cursor workspace ledger record')
    }
    expect(cursorRecord.metadata.pluginPath).toBe(
      path.join(workspace.rootDir, '.cursor', 'plugins', 'local', 'agentrig-sample-pack')
    )
    expect(cursorRecord.targetPaths).toEqual([
      path.join(workspace.rootDir, '.cursor', 'plugins', 'local', 'agentrig-sample-pack'),
    ])
  })

  it('uninstalls Cursor workspace plugins safely and clears the workspace ledger entry', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'cursor',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'workspace',
      force: true,
      clean: true,
    })

    const ledgersBefore = await loadPluginInstallLedgers(workspace.rootDir)
    const records = Object.values(ledgersBefore.workspace.installs)
    const uninstallResults = await uninstallPluginProviders(records, {
      cwd: workspace.rootDir,
    })

    expect(uninstallResults).toHaveLength(1)
    const cursorResult = uninstallResults[0]
    expect(cursorResult?.provider).toBe('cursor')
    expect(cursorResult?.removed).toEqual(['agentrig-sample-pack'])
    expect(cursorResult?.kept).toEqual([])

    await expect(
      fs.stat(path.join(workspace.rootDir, '.cursor', 'plugins', 'local', 'agentrig-sample-pack'))
    ).rejects.toThrow()

    const ledgersAfter = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgersAfter.workspace.installs)).toEqual([])
  })

  it('keeps modified Cursor workspace plugin files and preserves the workspace ledger entry', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'cursor',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'workspace',
      force: true,
      clean: true,
    })

    const cursorPluginManifestPath = path.join(
      workspace.rootDir,
      '.cursor',
      'plugins',
      'local',
      'agentrig-sample-pack',
      '.cursor-plugin',
      'plugin.json'
    )
    await fs.writeFile(cursorPluginManifestPath, '{ "mutated": true }\n', 'utf-8')

    const ledgersBefore = await loadPluginInstallLedgers(workspace.rootDir)
    const records = Object.values(ledgersBefore.workspace.installs)
    const uninstallResults = await uninstallPluginProviders(records, {
      cwd: workspace.rootDir,
    })

    expect(uninstallResults).toHaveLength(1)
    const cursorResult = uninstallResults[0]
    expect(cursorResult?.provider).toBe('cursor')
    expect(cursorResult?.removed).toEqual([])
    expect(cursorResult?.kept).toEqual(['agentrig-sample-pack'])

    expect(await fs.readFile(cursorPluginManifestPath, 'utf-8')).toContain('"mutated": true')

    const ledgersAfter = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgersAfter.workspace.installs)).toEqual(['cursor:workspace:agentrig-sample-pack'])
  })

  it('uninstalls safely, keeps modified files, and preserves unrelated marketplace entries', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    const preexistingMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json')
    await writeJson(preexistingMarketplacePath, {
      name: 'custom-market',
      interface: { displayName: 'Custom Market' },
      plugins: [
        {
          name: 'unrelated-plugin',
          source: { source: 'local', path: './.codex/plugins/unrelated-plugin' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Productivity',
        },
      ],
    })

    const installCalls: Array<{ command: string; args: string[] }> = []
    const installRunner: ExternalCommandRunner = async (command, args) => {
      installCalls.push({ command, args })
    }

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'all',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'personal',
      force: true,
      clean: true,
      commandRunner: installRunner,
    })

    const cursorPluginManifestPath = path.join(
      fakeHome,
      '.cursor',
      'plugins',
      'local',
      'agentrig-sample-pack',
      '.cursor-plugin',
      'plugin.json'
    )
    await fs.writeFile(cursorPluginManifestPath, '{ "mutated": true }\n', 'utf-8')

    const ledgersBefore = await loadPluginInstallLedgers(workspace.rootDir)
    const records = Object.values(ledgersBefore.personal.installs)

    const uninstallCalls: Array<{ command: string; args: string[] }> = []
    const uninstallRunner: ExternalCommandRunner = async (command, args) => {
      uninstallCalls.push({ command, args })
    }

    const uninstallResults = await uninstallPluginProviders(records, {
      cwd: workspace.rootDir,
      commandRunner: uninstallRunner,
    })

    const codexResult = uninstallResults.find((result) => result.provider === 'codex')
    expect(codexResult?.removed).toEqual(['agentrig-sample-pack'])
    expect(codexResult?.kept).toEqual([])

    const cursorResult = uninstallResults.find((result) => result.provider === 'cursor')
    expect(cursorResult?.removed).toEqual([])
    expect(cursorResult?.kept).toEqual(['agentrig-sample-pack'])

    const claudeResult = uninstallResults.find((result) => result.provider === 'claude')
    expect(claudeResult?.removed).toEqual(['agentrig-sample-pack'])

    expect(uninstallCalls).toEqual([
      {
        command: 'claude',
        args: ['plugin', 'uninstall', 'agentrig-sample-pack@agentrig-community', '--scope', 'user'],
      },
      {
        command: 'claude',
        args: ['plugin', 'marketplace', 'remove', 'agentrig-community'],
      },
    ])

    const codexPluginPath = path.join(fakeHome, '.codex', 'plugins', 'agentrig-sample-pack')
    await expect(fs.stat(codexPluginPath)).rejects.toThrow()

    const updatedMarketplace = JSON.parse(await fs.readFile(preexistingMarketplacePath, 'utf-8'))
    expect(updatedMarketplace.plugins).toEqual([
      {
        name: 'unrelated-plugin',
        source: { source: 'local', path: './.codex/plugins/unrelated-plugin' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      },
    ])

    expect(await fs.readFile(cursorPluginManifestPath, 'utf-8')).toContain('"mutated": true')

    const ledgersAfter = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgersAfter.personal.installs)).toEqual(['cursor:personal:agentrig-sample-pack'])
  })

  it('does not remove a preexisting Claude marketplace during uninstall', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    const installCalls: Array<{ command: string; args: string[] }> = []
    const installRunner: ExternalCommandRunner = async (command, args) => {
      installCalls.push({ command, args })
      if (command === 'claude' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
        throw new Error('Marketplace already exists')
      }
    }

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'claude',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'personal',
      force: true,
      clean: true,
      commandRunner: installRunner,
    })

    expect(installCalls).toEqual([
      {
        command: 'claude',
        args: ['plugin', 'marketplace', 'add', path.join(workspace.rootDir, 'generated')],
      },
      {
        command: 'claude',
        args: ['plugin', 'install', 'agentrig-sample-pack@agentrig-community', '--scope', 'user'],
      },
    ])

    const ledgersBefore = await loadPluginInstallLedgers(workspace.rootDir)
    const records = Object.values(ledgersBefore.personal.installs)
    expect(records).toHaveLength(1)
    const claudeRecord = records[0]
    expect(claudeRecord?.provider).toBe('claude')
    if (!claudeRecord || claudeRecord.provider !== 'claude') {
      throw new Error('Expected a Claude ledger record')
    }
    expect(claudeRecord.metadata.marketplaceAdded).toBe(false)

    const uninstallCalls: Array<{ command: string; args: string[] }> = []
    const uninstallRunner: ExternalCommandRunner = async (command, args) => {
      uninstallCalls.push({ command, args })
    }

    const uninstallResults = await uninstallPluginProviders(records, {
      cwd: workspace.rootDir,
      commandRunner: uninstallRunner,
    })

    expect(uninstallResults).toHaveLength(1)
    expect(uninstallResults[0]?.provider).toBe('claude')
    expect(uninstallResults[0]?.removed).toEqual(['agentrig-sample-pack'])
    expect(uninstallCalls).toEqual([
      {
        command: 'claude',
        args: ['plugin', 'uninstall', 'agentrig-sample-pack@agentrig-community', '--scope', 'user'],
      },
    ])

    const ledgersAfter = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgersAfter.personal.installs)).toEqual([])
  })

  it('keeps the Codex marketplace entry when plugin files were modified and preserves extra marketplace fields', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    const codexMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json')
    await writeJson(codexMarketplacePath, {
      name: 'custom-market',
      interface: { displayName: 'Custom Market' },
      customMetadata: { owner: 'user-managed' },
      plugins: [],
    })

    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'codex',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'personal',
      force: true,
      clean: true,
    })

    const marketplaceAfterInstall = JSON.parse(await fs.readFile(codexMarketplacePath, 'utf-8'))
    expect(marketplaceAfterInstall.customMetadata).toEqual({ owner: 'user-managed' })
    expect(marketplaceAfterInstall.plugins).toHaveLength(1)

    const codexPluginManifestPath = path.join(
      fakeHome,
      '.codex',
      'plugins',
      'agentrig-sample-pack',
      '.codex-plugin',
      'plugin.json'
    )
    await fs.writeFile(codexPluginManifestPath, '{ "mutated": true }\n', 'utf-8')

    const ledgersBefore = await loadPluginInstallLedgers(workspace.rootDir)
    const records = Object.values(ledgersBefore.personal.installs)
    const uninstallResults = await uninstallPluginProviders(records, {
      cwd: workspace.rootDir,
    })

    const codexResult = uninstallResults.find((result) => result.provider === 'codex')
    expect(codexResult?.removed).toEqual([])
    expect(codexResult?.kept).toEqual(['agentrig-sample-pack'])

    const marketplaceAfterUninstall = JSON.parse(await fs.readFile(codexMarketplacePath, 'utf-8'))
    expect(marketplaceAfterUninstall.customMetadata).toEqual({ owner: 'user-managed' })
    expect(marketplaceAfterUninstall.plugins).toEqual([
      expect.objectContaining({
        name: 'agentrig-sample-pack',
        source: expect.objectContaining({
          path: './.codex/plugins/agentrig-sample-pack',
        }),
      }),
    ])

    const ledgersAfter = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgersAfter.personal.installs)).toEqual(['codex:personal:agentrig-sample-pack'])
  })

  it('removes Codex marketplace entries using stable fields even when extra keys are present', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    const codexMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json')
    await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'codex',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'personal',
      force: true,
      clean: true,
    })

    const marketplace = JSON.parse(await fs.readFile(codexMarketplacePath, 'utf-8'))
    marketplace.plugins = marketplace.plugins.map((plugin: Record<string, unknown>) =>
      plugin.name === 'agentrig-sample-pack'
        ? {
            category: plugin.category,
            source: plugin.source,
            policy: plugin.policy,
            name: plugin.name,
            customFlag: true,
          }
        : plugin
    )
    await writeJson(codexMarketplacePath, marketplace)

    const ledgersBefore = await loadPluginInstallLedgers(workspace.rootDir)
    const records = Object.values(ledgersBefore.personal.installs)
    const uninstallResults = await uninstallPluginProviders(records, {
      cwd: workspace.rootDir,
    })

    const codexResult = uninstallResults.find((result) => result.provider === 'codex')
    expect(codexResult?.removed).toEqual(['agentrig-sample-pack'])
    expect(codexResult?.kept).toEqual([])

    const marketplaceAfterUninstall = JSON.parse(await fs.readFile(codexMarketplacePath, 'utf-8'))
    expect(marketplaceAfterUninstall.plugins).toEqual([])

    const ledgersAfter = await loadPluginInstallLedgers(workspace.rootDir)
    expect(Object.keys(ledgersAfter.personal.installs)).toEqual([])
  })
})
