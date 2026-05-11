import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { selfHealClaudeInstalls } from '../../src/lib/plugin-providers/claude-self-heal'
import {
  loadPluginInstallLedger,
  savePluginInstallLedger,
} from '../../src/lib/plugin-install-ledger'

const tempDirs: string[] = []

describe('selfHealClaudeInstalls', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('rewrites stale /tmp marketplace paths to the persistent staging dir when it exists', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')
    await fs.mkdir(persistentRoot, { recursive: true })
    await fs.writeFile(path.join(persistentRoot, 'marker.txt'), 'persistent')
    await writeClaudeMarketplaceManifest(persistentRoot, 'agentrig-community')

    const stalePath = '/tmp/agentrig-plugins-AbCdEf'
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 4,
      installs: {
        'claude:personal:agentrig-regenrek-agent-skills': makeStaleClaudeRecord(stalePath),
      },
      selections: {},
    })

    const knownMarketplacesPath = path.join(home, '.claude', 'plugins', 'known_marketplaces.json')
    await fs.mkdir(path.dirname(knownMarketplacesPath), { recursive: true })
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        'agentrig-community': {
          source: { source: 'directory', path: stalePath },
          installLocation: stalePath,
          lastUpdated: '2026-05-10T17:59:52.762Z',
        },
      }, null, 2)
    )

    const result = await selfHealClaudeInstalls(cwd)

    expect(result.patchedLedgerEntries).toEqual([
      expect.objectContaining({
        id: 'claude:personal:agentrig-regenrek-agent-skills',
        scope: 'personal',
        previousSource: stalePath,
        nextSource: persistentRoot,
      }),
    ])
    expect(result.patchedKnownMarketplaces).toEqual(['agentrig-community'])
    expect(result.warnings).toEqual([])

    const reloaded = await loadPluginInstallLedger(cwd, 'personal')
    const claudeRecord = reloaded.installs['claude:personal:agentrig-regenrek-agent-skills']
    expect(claudeRecord).toBeDefined()
    if (claudeRecord && claudeRecord.provider === 'claude') {
      expect(claudeRecord.metadata.marketplaceSourcePath).toBe(persistentRoot)
      expect(claudeRecord.targetPaths).toEqual([persistentRoot])
    }

    const reloadedKnown = JSON.parse(await fs.readFile(knownMarketplacesPath, 'utf-8'))
    expect(reloadedKnown['agentrig-community'].source.path).toBe(persistentRoot)
    expect(reloadedKnown['agentrig-community'].installLocation).toBe(persistentRoot)
  })

  it('does not patch the ledger when persistent staging lacks a valid marketplace manifest', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')
    await fs.mkdir(persistentRoot, { recursive: true })

    const stalePath = '/tmp/agentrig-plugins-InvalidStaging'
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 4,
      installs: {
        'claude:personal:agentrig-regenrek-agent-skills': makeStaleClaudeRecord(stalePath),
      },
      selections: {},
    })

    const result = await selfHealClaudeInstalls(cwd)

    expect(result.patchedLedgerEntries).toEqual([])
    expect(result.patchedKnownMarketplaces).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain('no valid Claude marketplace manifest exists')

    const reloaded = await loadPluginInstallLedger(cwd, 'personal')
    const claudeRecord = reloaded.installs['claude:personal:agentrig-regenrek-agent-skills']
    expect(claudeRecord).toBeDefined()
    if (claudeRecord && claudeRecord.provider === 'claude') {
      expect(claudeRecord.metadata.marketplaceSourcePath).toBe(stalePath)
      expect(claudeRecord.targetPaths).toEqual([stalePath])
    }
  })

  it('patches known marketplaces by marketplace name when its old path differs from the ledger', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')
    await fs.mkdir(persistentRoot, { recursive: true })
    await writeClaudeMarketplaceManifest(persistentRoot, 'agentrig-community')

    const ledgerStalePath = '/tmp/agentrig-plugins-LedgerPath'
    const knownStalePath = '/var/folders/zz/agentrig-plugins-KnownPath'
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 4,
      installs: {
        'claude:personal:agentrig-regenrek-agent-skills': makeStaleClaudeRecord(ledgerStalePath),
      },
      selections: {},
    })

    const knownMarketplacesPath = path.join(home, '.claude', 'plugins', 'known_marketplaces.json')
    await fs.mkdir(path.dirname(knownMarketplacesPath), { recursive: true })
    await fs.writeFile(
      knownMarketplacesPath,
      JSON.stringify({
        'agentrig-community': {
          source: { source: 'directory', path: knownStalePath },
          installLocation: knownStalePath,
          lastUpdated: '2026-05-10T17:59:52.762Z',
        },
      }, null, 2)
    )

    const result = await selfHealClaudeInstalls(cwd)

    expect(result.patchedKnownMarketplaces).toEqual(['agentrig-community'])
    expect(result.warnings).toEqual([])
    const reloadedKnown = JSON.parse(await fs.readFile(knownMarketplacesPath, 'utf-8'))
    expect(reloadedKnown['agentrig-community'].source.path).toBe(persistentRoot)
    expect(reloadedKnown['agentrig-community'].installLocation).toBe(persistentRoot)
  })

  it('warns when the ledger is patched but known marketplaces cannot be patched', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const persistentRoot = path.join(home, '.agentrig', 'cache', 'claude-marketplaces', 'agentrig-community')
    await fs.mkdir(persistentRoot, { recursive: true })
    await writeClaudeMarketplaceManifest(persistentRoot, 'agentrig-community')

    const stalePath = '/tmp/agentrig-plugins-NoKnownFile'
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 4,
      installs: {
        'claude:personal:agentrig-regenrek-agent-skills': makeStaleClaudeRecord(stalePath),
      },
      selections: {},
    })

    const result = await selfHealClaudeInstalls(cwd)

    expect(result.patchedLedgerEntries).toHaveLength(1)
    expect(result.patchedKnownMarketplaces).toEqual([])
    expect(result.warnings).toEqual([
      expect.stringContaining('known_marketplaces.json does not exist'),
    ])
  })

  it('emits a warning and leaves the ledger untouched when no persistent staging exists', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const stalePath = '/tmp/agentrig-plugins-NoStaging'
    await savePluginInstallLedger(cwd, 'personal', {
      schemaVersion: 4,
      installs: {
        'claude:personal:agentrig-regenrek-agent-skills': makeStaleClaudeRecord(stalePath),
      },
      selections: {},
    })

    const result = await selfHealClaudeInstalls(cwd)

    expect(result.patchedLedgerEntries).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain('agent-skills')
    expect(result.warnings[0]).toContain('--force')

    const reloaded = await loadPluginInstallLedger(cwd, 'personal')
    const claudeRecord = reloaded.installs['claude:personal:agentrig-regenrek-agent-skills']
    expect(claudeRecord).toBeDefined()
    if (claudeRecord && claudeRecord.provider === 'claude') {
      expect(claudeRecord.metadata.marketplaceSourcePath).toBe(stalePath)
    }
  })

  it('is a no-op when no claude install records exist', async () => {
    const root = await tempRoot()
    const cwd = path.join(root, 'workspace')
    const home = path.join(root, 'home')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    vi.stubEnv('AGENTRIG_HOME', home)

    const result = await selfHealClaudeInstalls(cwd)
    expect(result).toEqual({
      patchedLedgerEntries: [],
      patchedKnownMarketplaces: [],
      warnings: [],
    })
  })
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-selfheal-'))
  tempDirs.push(dir)
  return dir
}

function makeStaleClaudeRecord(stalePath: string): import('../../src/lib/types').ClaudePluginInstallRecord {
  return {
    id: 'claude:personal:agentrig-regenrek-agent-skills',
    provider: 'claude',
    requestedScope: 'personal',
    specIdentity: {
      kind: 'registry',
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      pluginId: 'regenrek.agent-skills',
      version: '0.0.0+main',
    },
    registry: {
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      sourceRepository: 'https://github.com/regenrek/agent-skills',
      contractVersion: '1',
      generatedAt: '2026-05-10T13:51:27.641Z',
      signature: {
        algorithm: 'install-bundle-file-list-sha256',
        keyId: 'agentrig-marketplace-listing',
        signedDigest: 'd'.repeat(64),
      },
    },
    scope: 'personal',
    pluginId: 'regenrek.agent-skills',
    pluginVersion: '0.0.0+main',
    snapshotDigest: 'a'.repeat(64),
    pluginName: 'agentrig-regenrek-agent-skills',
    targetPaths: [stalePath],
    installedAt: '2026-05-10T17:59:54.123Z',
    files: [] as [],
    metadata: {
      marketplaceName: 'agentrig-community',
      pluginRef: 'agentrig-regenrek-agent-skills@agentrig-community',
      scopeArg: 'user' as const,
      marketplaceSourcePath: stalePath,
      marketplaceAdded: true,
    },
  }
}

async function writeClaudeMarketplaceManifest(marketplaceRoot: string, name: string) {
  await fs.mkdir(path.join(marketplaceRoot, '.claude-plugin'), { recursive: true })
  await fs.writeFile(path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name,
    owner: { name: 'AgentRig' },
    metadata: {
      description: 'AgentRig community marketplace.',
      version: '1.0.0',
      pluginRoot: './plugins',
    },
    plugins: [],
  }, null, 2))
}
