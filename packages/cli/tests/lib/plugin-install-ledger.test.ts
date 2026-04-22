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
  it('archives schemaVersion 1 ledgers and resets them to the canonical v2 shape', async () => {
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
      schemaVersion: 2,
      installs: {},
    })

    const backupPath = path.join(cwd, '.agentrig', 'plugin-installs.v1-backup.json')
    const backup = JSON.parse(await readFile(backupPath, 'utf8'))
    expect(backup).toMatchObject({
      schemaVersion: 1,
      installs: expect.any(Object),
    })

    const rewritten = JSON.parse(await readFile(ledgerPath, 'utf8'))
    expect(rewritten).toEqual({
      schemaVersion: 2,
      installs: {},
    })
  })
})
