import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const codexAppServerMocks = vi.hoisted(() => ({
  codexInstallPlugin: vi.fn(),
  codexUninstallPlugin: vi.fn(),
}))

vi.mock('../../src/lib/plugin-providers/codex-app-server', () => codexAppServerMocks)

import { sha256Hex } from '../../src/lib/hash'
import { exportPluginProviders, installPluginProviders, uninstallPluginProviders } from '../../src/lib/plugin-providers'
import { loadPluginInstallLedgers, savePluginInstallLedger } from '../../src/lib/plugin-install-ledger'
import { defaultCommandRunner } from '../../src/lib/plugin-providers/shared'
import type { ResolvedPluginInstallMetadata } from '../../src/lib/plugin-providers/shared'
import type { ClaudePluginInstallRecord, CodexPluginInstallRecord, PluginInstallRecord } from '../../src/lib/types'

const tempDirs: string[] = []
const originalHome = process.env.HOME

describe('plugin provider command runner', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    codexAppServerMocks.codexInstallPlugin.mockReset()
    codexAppServerMocks.codexUninstallPlugin.mockReset()
    vi.unstubAllEnvs()
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('passes AGENTRIG_HOME through as provider CLI home', async () => {
    const root = await tempRoot()
    const realHome = path.join(root, 'real-home')
    const agentrigHome = path.join(root, 'agentrig-home')
    const outputPath = path.join(root, 'env.json')
    const scriptPath = path.join(root, 'write-env.mjs')
    await fs.mkdir(realHome, { recursive: true })
    await fs.mkdir(agentrigHome, { recursive: true })
    await fs.writeFile(
      scriptPath,
      [
        'import { writeFileSync } from "node:fs"',
        `writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }))`,
      ].join('\n')
    )
    process.env.HOME = realHome
    vi.stubEnv('AGENTRIG_HOME', agentrigHome)

    await defaultCommandRunner(process.execPath, [scriptPath])

    const env = JSON.parse(await fs.readFile(outputPath, 'utf-8')) as {
      HOME?: string
      USERPROFILE?: string
    }
    expect(env.HOME).toBe(agentrigHome)
    expect(env.USERPROFILE).toBe(agentrigHome)
  })

  it('refuses to uninstall files outside provider-owned roots even when a ledger path matches', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const outside = path.join(root, 'outside.txt')
    await fs.mkdir(cwd, { recursive: true })
    await fs.writeFile(outside, 'owned-by-user')

    const maliciousRecord: PluginInstallRecord = {
      id: 'cursor:workspace:agentrig-review',
      provider: 'cursor',
      requestedScope: 'workspace',
      specIdentity: {
        kind: 'external-repo',
        repoUrl: 'https://github.com/acme/tools',
        owner: 'acme',
        repo: 'tools',
        commitSha: '1234567890abcdef1234567890abcdef12345678',
        scanDigest: 'a'.repeat(64),
        pickedSignalPaths: ['skills/review'],
        pluginId: 'community.review',
        version: '0.1.0',
      },
      scope: 'workspace',
      pluginId: 'community.review',
      pluginVersion: '0.1.0',
      snapshotDigest: 'b'.repeat(64),
      pluginName: 'agentrig-review',
      targetPaths: [outside],
      installedAt: '2026-05-09T00:00:00.000Z',
      files: [{
        path: outside,
        sha256: sha256Hex(Buffer.from('owned-by-user')),
      }],
      metadata: {
        pluginPath: path.dirname(outside),
      },
    }

    await expect(uninstallPluginProviders([maliciousRecord], { cwd })).rejects.toThrow(/Unsafe (Cursor plugin install|installed file) path/)
    await expect(fs.readFile(outside, 'utf-8')).resolves.toBe('owned-by-user')
  })

  it('installs dotted artifact IDs into Codex with provider-safe plugin names', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: true,
      installPath: path.join(home, '.codex', 'plugins', 'cache', 'agentrig-local', 'agentrig-regenrek-agent-skills', '1.0.0'),
      authPolicy: 'ON_INSTALL',
      appsNeedingAuth: [],
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })

    const providerName = 'agentrig-regenrek-agent-skills'
    expect(result[0]?.installed).toEqual([providerName])
    expect(codexAppServerMocks.codexInstallPlugin).toHaveBeenCalledWith(expect.objectContaining({
      pluginName: providerName,
    }))
    const ledgers = await loadPluginInstallLedgers(cwd)
    expect(Object.values(ledgers.personal.installs)[0]).toMatchObject({
      pluginId: 'regenrek.agent-skills',
      pluginName: providerName,
      specIdentity: {
        kind: 'external-repo',
        pluginId: 'regenrek.agent-skills',
      },
    })
  })

  it('stages Codex marketplaces persistently and installs through app-server', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: true,
      installPath: path.join(home, '.codex', 'plugins', 'cache', 'agentrig-local', 'agentrig-regenrek-agent-skills', '1.0.0'),
      authPolicy: 'ON_INSTALL',
      appsNeedingAuth: [],
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })

    const providerName = 'agentrig-regenrek-agent-skills'
    const persistentRoot = path.join(home, '.agentrig', 'cache', 'codex-marketplaces', 'agentrig-local')
    expect(codexAppServerMocks.codexInstallPlugin).toHaveBeenCalledWith({
      marketplaceName: 'agentrig-local',
      pluginName: providerName,
      version: '1.0.0',
      sourcePath: path.join(persistentRoot, '.agents', 'plugins', 'marketplace.json'),
      enable: true,
    })
    await expect(fs.access(path.join(persistentRoot, '.agents', 'plugins', 'marketplace.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(persistentRoot, 'plugins', providerName, '.codex-plugin', 'plugin.json'))).resolves.toBeUndefined()
    await expect(
      readJson(path.join(persistentRoot, 'plugins', providerName, '.codex-plugin', 'plugin.json'))
    ).resolves.toMatchObject({
      name: providerName,
      interface: {
        displayName: 'Agent Skills',
        category: 'Other',
      },
    })
    await expect(
      readJson(path.join(persistentRoot, '.agents', 'plugins', 'marketplace.json'))
    ).resolves.toMatchObject({
      plugins: [
        {
          name: providerName,
          category: 'Other',
        },
      ],
    })
    expect(result[0]?.installed).toEqual([providerName])
    expect(result[0]?.locations[0]).toBe(persistentRoot)
    const ledgers = await loadPluginInstallLedgers(cwd)
    expect(Object.values(ledgers.personal.installs)[0]).toMatchObject({
      provider: 'codex',
      pluginId: 'regenrek.agent-skills',
      pluginName: providerName,
      files: [],
      metadata: {
        marketplaceName: 'agentrig-local',
        pluginRef: `${providerName}@agentrig-local`,
        appServerInstalled: true,
      },
    })
  })

  it('installs standard-only packages without a registry category in plugin.json', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: true,
      installPath: path.join(home, '.codex', 'plugins', 'cache', 'agentrig-local', 'agentrig-regenrek-agent-skills', '1.0.0'),
      authPolicy: 'ON_INSTALL',
      appsNeedingAuth: [],
    })

    await expect(installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })).resolves.toHaveLength(1)
    expect(codexAppServerMocks.codexInstallPlugin).toHaveBeenCalledOnce()
  })

  it('passes Codex no-enable through to app-server installs', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: true,
      installPath: path.join(home, '.codex', 'plugins', 'cache', 'agentrig-local', 'agentrig-regenrek-agent-skills', '1.0.0'),
      authPolicy: 'ON_INSTALL',
      appsNeedingAuth: [],
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      enable: false,
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })

    expect(codexAppServerMocks.codexInstallPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ enable: false })
    )
  })

  it('requires Codex CLI when app-server is missing', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: false,
      reason: 'codex_not_installed',
      detail: 'missing codex',
    })

    await expect(installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })).rejects.toThrow(/Codex CLI >= 0\.113\.0 is required/)
    await expect(fs.access(path.join(home, '.agents', 'plugins', 'marketplace.json'))).rejects.toThrow()
  })

  it('requires Codex CLI when app-server is too old', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: false,
      reason: 'codex_too_old',
      detail: 'Codex 0.113.0 or newer is required; detected 0.109.0.',
    })

    await expect(installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })).rejects.toThrow(/AgentRig does not edit ~\/\.agents\/plugins\/marketplace\.json directly/)
  })

  it('rejects workspace-scoped Codex plugin installs', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')

    await expect(installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'workspace',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })).rejects.toThrow(/Codex plugins only support --scope personal/)
    expect(codexAppServerMocks.codexInstallPlugin).not.toHaveBeenCalled()
  })

  it('rejects workspace-scoped Codex plugin uninstalls', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const record: CodexPluginInstallRecord = {
      id: 'codex:workspace:agentrig-regenrek-agent-skills',
      provider: 'codex',
      requestedScope: 'workspace',
      specIdentity: installMetadata('regenrek.agent-skills').specIdentity,
      scope: 'workspace',
      pluginId: 'regenrek.agent-skills',
      pluginVersion: '1.0.0',
      snapshotDigest: 'b'.repeat(64),
      pluginName: 'agentrig-regenrek-agent-skills',
      targetPaths: ['/tmp/codex-plugin'],
      installedAt: '2026-05-10T17:59:54.123Z',
      files: [],
      metadata: {
        pluginPath: '/tmp/codex-plugin',
        marketplacePath: '/tmp/marketplace.json',
        marketplaceName: 'agentrig-local',
        pluginRef: 'agentrig-regenrek-agent-skills@agentrig-local',
        appServerInstalled: true,
        marketplaceEntry: {
          name: 'agentrig-regenrek-agent-skills',
          source: { source: 'local', path: './plugins/agentrig-regenrek-agent-skills' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Development',
        },
      },
    }

    await expect(uninstallPluginProviders([record], { cwd }))
      .rejects.toThrow(/Codex plugins only support --scope personal/)
    expect(codexAppServerMocks.codexUninstallPlugin).not.toHaveBeenCalled()
  })

  it('hard-fails Codex installs on app-server rpc errors', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')
    codexAppServerMocks.codexInstallPlugin.mockResolvedValue({
      ok: false,
      reason: 'rpc_error',
      detail: 'plugin/install failed (-32001): boom',
    })

    await expect(installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })).rejects.toThrow(/boom/)
  })

  it('claude install stages marketplace into a persistent agentrig cache and registers via that path', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')

    const runnerCalls: Array<{ command: string; args: string[] }> = []
    const recordingRunner = async (command: string, args: string[]) => {
      runnerCalls.push({ command, args })
    }

    const installResults = await installPluginProviders({
      cwd,
      agent: 'claude',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
      commandRunner: recordingRunner,
    })

    const providerName = 'agentrig-regenrek-agent-skills'
    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')

    // Persistent staging exists with the rendered marketplace contents.
    await expect(fs.access(persistentRoot)).resolves.toBeUndefined()
    await expect(fs.access(path.join(persistentRoot, '.claude-plugin', 'marketplace.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(persistentRoot, 'plugins', providerName, '.claude-plugin', 'plugin.json'))).resolves.toBeUndefined()

    // The Claude CLI was invoked against the persistent cache path, never the ephemeral export root.
    const marketplaceAddCall = runnerCalls.find(
      (call) => call.command === 'claude' && call.args[0] === 'plugin' && call.args[1] === 'marketplace' && call.args[2] === 'add'
    )
    expect(marketplaceAddCall).toBeDefined()
    expect(marketplaceAddCall?.args[3]).toBe(persistentRoot)
    expect(marketplaceAddCall?.args[3]).not.toContain('/agentrig-plugins-')

    expect(installResults[0]?.installed).toEqual([providerName])
    expect(installResults[0]?.locations).toEqual([persistentRoot])

    const ledgers = await loadPluginInstallLedgers(cwd)
    const ledgerRecord = Object.values(ledgers.personal.installs)[0]
    expect(ledgerRecord).toMatchObject({
      provider: 'claude',
      pluginId: 'regenrek.agent-skills',
      pluginName: providerName,
      targetPaths: [persistentRoot],
      metadata: {
        marketplaceName: 'agentrig-community',
        marketplaceSourcePath: persistentRoot,
      },
    })
  })

  it('restores prior Claude persistent staging when replacement fails', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    const pluginsRoot = path.join(root, 'plugins')
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')

    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')
    await fs.mkdir(persistentRoot, { recursive: true })
    await fs.writeFile(path.join(persistentRoot, 'old-marker.txt'), 'old staging')

    const originalRename = fs.rename.bind(fs)
    const rename = vi.spyOn(fs, 'rename')
    rename.mockImplementation(async (source, destination) => {
      if (String(source).includes('.agentrig-community.staging-') && destination === persistentRoot) {
        throw new Error('rename failed')
      }
      return originalRename(source, destination)
    })

    await expect(installPluginProviders({
      cwd,
      agent: 'claude',
      pluginsDir: pluginsRoot,
      scope: 'personal',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
      commandRunner: async () => {},
    })).rejects.toThrow(/rename failed/)

    await expect(fs.readFile(path.join(persistentRoot, 'old-marker.txt'), 'utf-8')).resolves.toBe('old staging')
  })

  it('keeps Claude persistent staging when plugin uninstall fails and the ledger entry remains', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')
    await fs.mkdir(persistentRoot, { recursive: true })
    await fs.writeFile(path.join(persistentRoot, 'marketplace-marker.txt'), 'still installed')
    const record = claudeInstallRecord(persistentRoot)
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 4,
      installs: { [record.id]: record },
      selections: {},
    })
    const runnerCalls: Array<{ command: string; args: string[] }> = []

    const result = await uninstallPluginProviders([record], {
      cwd,
      commandRunner: async (command, args) => {
        runnerCalls.push({ command, args })
        if (args[0] === 'plugin' && args[1] === 'uninstall') {
          throw new Error('Claude refused uninstall')
        }
      },
    })

    expect(result[0]).toMatchObject({
      kept: ['agentrig-regenrek-agent-skills'],
      clearedRecordIds: [],
    })
    expect(runnerCalls.some((call) => call.args[0] === 'plugin' && call.args[1] === 'marketplace' && call.args[2] === 'remove')).toBe(false)
    await expect(fs.readFile(path.join(persistentRoot, 'marketplace-marker.txt'), 'utf-8')).resolves.toBe('still installed')
    const ledgers = await loadPluginInstallLedgers(cwd)
    expect(ledgers.personal.installs[record.id]).toBeDefined()
  })

  it('exports provider-native compatibility files without an unsupported Claude root pointer', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    const out = path.join(root, 'out')
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills', {
      skill: true,
      mcp: true,
      settings: true,
      components: true,
    })

    await exportPluginProviders({
      cwd,
      agent: 'all',
      pluginsDir: pluginsRoot,
      out,
    })

    const providerName = 'agentrig-regenrek-agent-skills'
    const codexRoot = path.join(out, 'codex', 'plugins', providerName)
    const claudeRoot = path.join(out, 'claude', 'plugins', providerName)
    const cursorRoot = path.join(out, 'cursor', 'plugins', providerName)

    await expect(fs.readFile(path.join(codexRoot, 'AGENTS.md'), 'utf-8')).resolves.toContain('project-spec-packager')
    await expect(fs.readFile(path.join(codexRoot, 'AGENTS.md'), 'utf-8')).resolves.toContain('sandbox')
    await expect(readJson(path.join(codexRoot, '.codex-plugin', 'plugin.json'))).resolves.toMatchObject({
      skills: './skills/',
      mcpServers: './.mcp.json',
      apps: './.app.json',
    })
    await expect(fs.access(path.join(codexRoot, 'scripts', 'server.mjs'))).resolves.toBeUndefined()

    await expect(fs.access(path.join(claudeRoot, 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(claudeRoot, '.mcp.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(claudeRoot, 'commands', 'review.md'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(claudeRoot, 'agents', 'reviewer.md'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(claudeRoot, 'hooks', 'hooks.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(claudeRoot, 'settings.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(claudeRoot, '.lsp.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(claudeRoot, 'scripts', 'server.mjs'))).resolves.toBeUndefined()
    await expect(readJson(path.join(claudeRoot, '.mcp.json'))).resolves.toMatchObject({
      mcpServers: {
        docs: {
          args: ['${CLAUDE_PLUGIN_ROOT}/scripts/server.mjs'],
          cwd: '${CLAUDE_PLUGIN_ROOT}',
          env: {
            CLAUDE_PLUGIN_ROOT: '${CLAUDE_PLUGIN_ROOT}',
            CLAUDE_PLUGIN_DATA: '${CLAUDE_PLUGIN_DATA}',
            CLAUDE_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}',
          },
        },
      },
    })

    await expect(fs.readFile(path.join(cursorRoot, 'CURSOR.md'), 'utf-8')).resolves.toContain('agentrig doctor --provider cursor')
    await expect(fs.readFile(path.join(cursorRoot, 'rules', 'agentrig-provider.mdc'), 'utf-8')).resolves.toContain('provider-neutral')
    await expect(fs.access(path.join(cursorRoot, 'rules', 'typescript.mdc'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(cursorRoot, 'commands', 'review.md'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(cursorRoot, 'agents', 'reviewer.md'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(cursorRoot, 'hooks', 'hooks.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(cursorRoot, 'scripts', 'server.mjs'))).resolves.toBeUndefined()
    await expect(readJson(path.join(cursorRoot, '.cursor-plugin', 'plugin.json'))).resolves.toMatchObject({
      rules: './rules',
      skills: './skills',
      mcpServers: './mcp.json',
    })
    await expect(fs.access(path.join(cursorRoot, 'mcp.json'))).resolves.toBeUndefined()
  })

  it('uses the tolerant SDK inspection result and preserves package support payloads', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    const out = path.join(root, 'out')
    const pluginId = 'community.tolerant-package'
    const pluginRoot = path.join(pluginsRoot, pluginId)
    await writePluginSource(pluginsRoot, pluginId, { skill: true, mcp: true })
    await fs.writeFile(path.join(pluginRoot, 'config.json'), '{"mode":"portable"}\n')
    await fs.writeFile(path.join(pluginRoot, 'README.md'), '# Portable support\n')
    await fs.mkdir(path.join(pluginRoot, 'assets'), { recursive: true })
    await fs.writeFile(path.join(pluginRoot, 'assets', 'logo.txt'), 'portable asset\n')
    await fs.writeFile(path.join(pluginRoot, '.env'), 'SECRET=do-not-export\n')
    await fs.writeFile(path.join(pluginRoot, 'CLAUDE.md'), 'do-not-export\n')
    await fs.mkdir(path.join(pluginRoot, 'commands'), { recursive: true })
    await fs.writeFile(path.join(pluginRoot, 'commands', 'legacy.md'), 'do-not-export\n')
    await fs.mkdir(path.join(pluginRoot, 'node_modules', 'private-package'), { recursive: true })
    await fs.writeFile(path.join(pluginRoot, 'node_modules', 'private-package', 'secret.txt'), 'do-not-export\n')
    await fs.mkdir(path.join(pluginRoot, 'skills', 'invalid'), { recursive: true })
    await fs.writeFile(path.join(pluginRoot, 'skills', 'invalid', 'SKILL.md'), '# Missing frontmatter\n')
    const manifest = await readJson(path.join(pluginRoot, 'plugin.json')) as Record<string, unknown>
    manifest.extensions = 'invalid-extension-container'
    await fs.writeFile(path.join(pluginRoot, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    const results = await exportPluginProviders({
      cwd,
      agent: 'all',
      pluginsDir: pluginsRoot,
      out,
    })

    for (const result of results) {
      expect(result.plugins[0]?.inspection.conformance.loadable).toBe(true)
      expect(result.plugins[0]?.inspection.diagnostics.length).toBeGreaterThan(0)
      const providerRoot = path.join(out, result.provider, 'plugins', 'agentrig-community-tolerant-package')
      await expect(fs.readFile(path.join(providerRoot, 'config.json'), 'utf-8')).resolves.toBe('{"mode":"portable"}\n')
      await expect(fs.readFile(path.join(providerRoot, 'README.md'), 'utf-8')).resolves.toBe('# Portable support\n')
      await expect(fs.readFile(path.join(providerRoot, 'assets', 'logo.txt'), 'utf-8')).resolves.toBe('portable asset\n')
      await expect(fs.access(path.join(providerRoot, '.env'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.access(path.join(providerRoot, 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.access(path.join(providerRoot, 'commands', 'legacy.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.access(path.join(providerRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.access(path.join(providerRoot, 'skills', 'project-spec-packager', 'SKILL.md'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(providerRoot, 'skills', 'invalid'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('isolates a nested skill symlink that escapes the plugin root', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    const pluginId = 'community.escape-skill'
    await writePluginSource(pluginsRoot, pluginId, { skill: true })
    const outside = path.join(root, 'outside-skill')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'SKILL.md'), 'outside\n')
    await fs.symlink(outside, path.join(pluginsRoot, pluginId, 'skills', 'escape'))

    const [result] = await exportPluginProviders({
      cwd,
      agent: 'cursor',
      pluginsDir: pluginsRoot,
      out: path.join(root, 'out'),
    })

    expect(result?.plugins[0]?.inspection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'filesystem.path-escape',
      path: 'skills/escape/SKILL.md',
    }))
    await expect(fs.access(path.join(root, 'out', 'plugins', 'agentrig-community-escape-skill', 'skills', 'escape')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('isolates an MCP source symlink that escapes the plugin root', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    const pluginId = 'community.escape-mcp'
    await writePluginSource(pluginsRoot, pluginId)
    const outsideMcp = path.join(root, 'outside-mcp.json')
    await fs.writeFile(outsideMcp, JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {},
    }))
    await fs.symlink(outsideMcp, path.join(pluginsRoot, pluginId, 'mcp.json'))

    const [result] = await exportPluginProviders({
      cwd,
      agent: 'cursor',
      pluginsDir: pluginsRoot,
      out: path.join(root, 'out'),
    })

    expect(result?.plugins[0]?.inspection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'filesystem.path-escape',
      path: 'mcp.json',
    }))
    await expect(fs.access(path.join(root, 'out', 'plugins', 'agentrig-community-escape-mcp', 'mcp.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-providers-'))
  tempDirs.push(dir)
  return dir
}

async function writePluginSource(
  pluginsRoot: string,
  pluginId: string,
  options: { skill?: boolean; mcp?: boolean; settings?: boolean; components?: boolean } = {}
) {
  const pluginDir = path.join(pluginsRoot, pluginId)
  await fs.mkdir(pluginDir, { recursive: true })
  if (options.skill) {
    await fs.mkdir(path.join(pluginDir, 'skills', 'project-spec-packager'), { recursive: true })
    await fs.writeFile(
      path.join(pluginDir, 'skills', 'project-spec-packager', 'SKILL.md'),
      [
        '---',
        'name: project-spec-packager',
        'description: Package app, SaaS, API, AI product, or internal-tool ideas into build-ready specs.',
        '---',
        '',
        '# Project Spec Packager',
      ].join('\n')
    )
  }
  if (options.mcp) {
    await fs.mkdir(path.join(pluginDir, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(pluginDir, 'scripts', 'server.mjs'), 'process.stdin.resume()\n')
    await fs.writeFile(
      path.join(pluginDir, 'mcp.json'),
      JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: {
          docs: {
            type: 'stdio',
            command: 'node',
            args: ['${PLUGIN_ROOT}/scripts/server.mjs'],
            cwd: '${PLUGIN_ROOT}',
          },
          invalid: {
            type: 'stdio',
            command: 'node server.mjs',
          },
        },
      }, null, 2)
    )
  }
  if (options.settings) {
    await fs.mkdir(path.join(pluginDir, 'ai.agentrig'), { recursive: true })
    await fs.writeFile(path.join(pluginDir, 'ai.agentrig', 'settings.json'), JSON.stringify({ permissions: {} }, null, 2))
  }
  if (options.components) {
    await fs.mkdir(path.join(pluginDir, 'ai.agentrig', 'commands'), { recursive: true })
    await fs.mkdir(path.join(pluginDir, 'ai.agentrig', 'agents'), { recursive: true })
    await fs.mkdir(path.join(pluginDir, 'ai.agentrig', 'hooks'), { recursive: true })
    await fs.mkdir(path.join(pluginDir, 'ai.agentrig', 'rules'), { recursive: true })
    await fs.writeFile(path.join(pluginDir, 'ai.agentrig', 'commands', 'review.md'), '# Review\n')
    await fs.writeFile(path.join(pluginDir, 'ai.agentrig', 'agents', 'reviewer.md'), '# Reviewer\n')
    await fs.writeFile(
      path.join(pluginDir, 'ai.agentrig', 'hooks', 'hooks.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] }] } }, null, 2)
    )
    await fs.writeFile(path.join(pluginDir, 'ai.agentrig', 'rules', 'typescript.mdc'), '# TypeScript\n')
    await fs.writeFile(path.join(pluginDir, 'ai.agentrig', 'lsp.json'), '{}\n')
    await fs.writeFile(path.join(pluginDir, 'ai.agentrig', 'app.json'), '{}\n')
  }
  await fs.writeFile(path.join(pluginDir, 'plugin.json'), `${JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: pluginId,
    description: 'Dotted artifact plugin for provider install tests.',
    version: '1.0.0',
    extensions: {
      'ai.agentrig': {
        displayName: 'Agent Skills',
      },
    },
  }, null, 2)}\n`)
}

function installMetadata(pluginId: string): ResolvedPluginInstallMetadata {
  return {
    specIdentity: {
      kind: 'external-repo',
      repoUrl: 'https://github.com/regenrek/agent-skills',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      scanDigest: 'a'.repeat(64),
      pickedSignalPaths: ['skills/research'],
      pluginId,
      version: '1.0.0',
    },
    snapshotDigest: 'b'.repeat(64),
  }
}

async function readJson(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown
}

function claudeInstallRecord(persistentRoot: string): ClaudePluginInstallRecord {
  return {
    id: 'claude:personal:agentrig-regenrek-agent-skills',
    provider: 'claude',
    requestedScope: 'personal',
    specIdentity: {
      kind: 'external-repo',
      repoUrl: 'https://github.com/regenrek/agent-skills',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      scanDigest: 'a'.repeat(64),
      pickedSignalPaths: ['skills/research'],
      pluginId: 'regenrek.agent-skills',
      version: '1.0.0',
    },
    scope: 'personal',
    pluginId: 'regenrek.agent-skills',
    pluginVersion: '1.0.0',
    snapshotDigest: 'b'.repeat(64),
    pluginName: 'agentrig-regenrek-agent-skills',
    targetPaths: [persistentRoot],
    installedAt: '2026-05-10T17:59:54.123Z',
    files: [],
    metadata: {
      marketplaceName: 'agentrig-community',
      pluginRef: 'agentrig-regenrek-agent-skills@agentrig-community',
      scopeArg: 'user',
      marketplaceSourcePath: persistentRoot,
      marketplaceAdded: true,
    },
  }
}
