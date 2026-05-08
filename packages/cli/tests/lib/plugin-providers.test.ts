import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultCommandRunner } from '../../src/lib/plugin-providers/shared'

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
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-providers-'))
  tempDirs.push(dir)
  return dir
}
