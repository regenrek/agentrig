import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sha256Hex } from '../../src/lib/hash'
import { uninstallPluginProviders } from '../../src/lib/plugin-providers'
import { defaultCommandRunner } from '../../src/lib/plugin-providers/shared'
import type { PluginInstallRecord } from '../../src/lib/types'

const tempDirs: string[] = []
const originalHome = process.env.HOME

describe('plugin provider command runner', () => {
  afterEach(async () => {
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

    await expect(uninstallPluginProviders([maliciousRecord], { cwd })).rejects.toThrow(/Unsafe installed file path/)
    await expect(fs.readFile(outside, 'utf-8')).resolves.toBe('owned-by-user')
  })
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-providers-'))
  tempDirs.push(dir)
  return dir
}
