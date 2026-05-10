import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sha256Hex } from '../../src/lib/hash'
import { installPluginProviders, uninstallPluginProviders } from '../../src/lib/plugin-providers'
import { loadPluginInstallLedgers, savePluginInstallLedger } from '../../src/lib/plugin-install-ledger'
import { defaultCommandRunner } from '../../src/lib/plugin-providers/shared'
import type { ResolvedPluginInstallMetadata } from '../../src/lib/plugin-providers/shared'
import type { ClaudePluginInstallRecord, PluginInstallRecord } from '../../src/lib/types'

const tempDirs: string[] = []
const originalHome = process.env.HOME

describe('plugin provider command runner', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
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
    const pluginsRoot = path.join(root, 'plugins')
    await writePluginSource(pluginsRoot, 'regenrek.agent-skills')

    const result = await installPluginProviders({
      cwd,
      agent: 'codex',
      pluginsDir: pluginsRoot,
      scope: 'workspace',
      installMetadataByPluginId: {
        'regenrek.agent-skills': installMetadata('regenrek.agent-skills'),
      },
    })

    const providerName = 'agentrig-regenrek-agent-skills'
    expect(result[0]?.installed).toEqual([providerName])
    await expect(readJson(path.join(cwd, 'plugins', providerName, '.codex-plugin', 'plugin.json'))).resolves.toMatchObject({
      name: providerName,
    })
    await expect(readJson(path.join(cwd, '.agents', 'plugins', 'marketplace.json'))).resolves.toMatchObject({
      plugins: [
        expect.objectContaining({
          name: providerName,
          source: { source: 'local', path: `./plugins/${providerName}` },
        }),
      ],
    })
    const ledgers = await loadPluginInstallLedgers(cwd)
    expect(Object.values(ledgers.workspace.installs)[0]).toMatchObject({
      pluginId: 'regenrek.agent-skills',
      pluginName: providerName,
      specIdentity: {
        kind: 'external-repo',
        pluginId: 'regenrek.agent-skills',
      },
    })
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
      schemaVersion: 3,
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
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-providers-'))
  tempDirs.push(dir)
  return dir
}

async function writePluginSource(pluginsRoot: string, pluginId: string) {
  const pluginDir = path.join(pluginsRoot, pluginId)
  await fs.mkdir(path.join(pluginDir, '.plugin'), { recursive: true })
  await fs.writeFile(path.join(pluginDir, '.plugin', 'plugin.json'), `${JSON.stringify({
    kind: 'agentrig:plugin',
    id: pluginId,
    name: pluginId,
    description: 'Dotted artifact plugin for provider install tests.',
    version: '1.0.0',
    configSchema: {},
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
