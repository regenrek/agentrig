import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { loadPluginInstallLedger } from '../../src/lib/plugin-install-ledger'
import { ensureDir, writeJsonFile } from '../../src/lib/fs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('loadPluginInstallLedger', () => {
  it('archives schemaVersion 1 ledgers and resets them to the canonical v3 shape', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-ledger-test-'))
    tempDirs.push(cwd)

    const ledgerPath = path.join(cwd, '.agentrig', 'plugin-installs.json')
    await ensureDir(path.dirname(ledgerPath))
    await writeJsonFile(ledgerPath, {
      schemaVersion: 1,
      installs: {
        'codex:personal:agentrig-typescript': {
          id: 'codex:personal:agentrig-typescript',
          provider: 'codex',
          requestedScope: 'personal',
          specIdentity: {
            kind: 'registry',
            registryUrl: 'https://agentrig.ai/registry',
            packName: 'typescript',
          },
          scope: 'personal',
          packName: 'typescript',
          packVersion: '0.1.0',
          pluginName: 'agentrig-typescript',
          sourceLocation: '/tmp/agentrig-typescript',
          targetPaths: ['/tmp/agentrig-typescript'],
          installedAt: '2026-03-29T00:06:43.922Z',
          files: [],
        },
      },
    })

    const ledger = await loadPluginInstallLedger(cwd, 'workspace')
    expect(ledger).toEqual({
      schemaVersion: 3,
      installs: {},
      selections: {},
    })

    const backupPath = path.join(cwd, '.agentrig', 'plugin-installs.v1-backup.json')
    const backup = JSON.parse(await readFile(backupPath, 'utf8'))
    expect(backup).toMatchObject({
      schemaVersion: 1,
      installs: expect.any(Object),
    })

    const rewritten = JSON.parse(await readFile(ledgerPath, 'utf8'))
    expect(rewritten).toEqual({
      schemaVersion: 3,
      installs: {},
      selections: {},
    })
  })

  it('loads external-repo installs without registry trust metadata', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-ledger-test-'))
    tempDirs.push(cwd)

    const ledgerPath = path.join(cwd, '.agentrig', 'plugin-installs.json')
    await ensureDir(path.dirname(ledgerPath))
    await writeJsonFile(ledgerPath, {
      schemaVersion: 2,
      installs: {
        'cursor:workspace:agentrig-community.review': {
          id: 'cursor:workspace:agentrig-community.review',
          provider: 'cursor',
          requestedScope: 'workspace',
          specIdentity: {
            kind: 'external-repo',
            repoUrl: 'https://github.com/acme/dots',
            owner: 'acme',
            repo: 'dots',
            commitSha: 'abc123',
            scanDigest: 'a'.repeat(64),
            pickedSignalPaths: ['skills/review'],
            pluginId: 'community.review',
            version: '0.1.0',
          },
          scope: 'workspace',
          pluginId: 'community.review',
          pluginVersion: '0.1.0',
          snapshotDigest: 'b'.repeat(64),
          pluginName: 'agentrig-community.review',
          targetPaths: ['/repo/.cursor/plugins/local/agentrig-community.review'],
          installedAt: '2026-04-24T00:00:00.000Z',
          files: [],
          metadata: {
            pluginPath: '/repo/.cursor/plugins/local/agentrig-community.review',
          },
        },
      },
    })

    const ledger = await loadPluginInstallLedger(cwd, 'workspace')
    expect(ledger.schemaVersion).toBe(3)
    expect(ledger.selections).toEqual({})
    const record = ledger.installs['cursor:workspace:agentrig-community.review']
    expect(record.registry).toBeUndefined()
    expect(record.specIdentity).toMatchObject({
      kind: 'external-repo',
      repoUrl: 'https://github.com/acme/dots',
      commitSha: 'abc123',
      pickedSignalPaths: ['skills/review'],
    })
  })

  it('rejects registry installs without verified registry metadata', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-ledger-test-'))
    tempDirs.push(cwd)

    const ledgerPath = path.join(cwd, '.agentrig', 'plugin-installs.json')
    await ensureDir(path.dirname(ledgerPath))
    await writeJsonFile(ledgerPath, {
      schemaVersion: 2,
      installs: {
        'cursor:workspace:agentrig-community.review': {
          id: 'cursor:workspace:agentrig-community.review',
          provider: 'cursor',
          requestedScope: 'workspace',
          specIdentity: {
            kind: 'registry',
            registryAlias: 'agentrig',
            registryUrl: 'https://agentrig.ai/registry',
            pluginId: 'community.review',
            version: '0.1.0',
          },
          scope: 'workspace',
          pluginId: 'community.review',
          pluginVersion: '0.1.0',
          snapshotDigest: 'b'.repeat(64),
          pluginName: 'agentrig-community.review',
          targetPaths: ['/repo/.cursor/plugins/local/agentrig-community.review'],
          installedAt: '2026-04-24T00:00:00.000Z',
          files: [],
          metadata: {
            pluginPath: '/repo/.cursor/plugins/local/agentrig-community.review',
          },
        },
      },
    })

    await expect(loadPluginInstallLedger(cwd, 'workspace')).rejects.toThrow(/verified registry metadata/i)
  })
})
