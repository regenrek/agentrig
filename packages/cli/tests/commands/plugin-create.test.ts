import { afterEach, describe, expect, it } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import command from '../../src/commands/plugin/create'

describe('command:plugin create', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('creates a valid plugin manifest with a non-empty default description', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-create-'))
    tempDirs.push(tempRoot)
    const pluginDir = path.join(tempRoot, 'demo-plugin')
    await fs.mkdir(pluginDir, { recursive: true })

    await run({
      args: {
        dir: pluginDir,
        id: 'demo-plugin',
        name: undefined,
        description: undefined,
        version: '0.1.0',
        out: undefined,
        force: false,
        help: false,
      },
    })

    const manifestPath = path.join(pluginDir, '.plugin', 'plugin.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as {
      name: string
      description: string
      'x-agentrig': {
        displayName: string
      }
    }

    expect(manifest.name).toBe('demo-plugin')
    expect(manifest.description).toBeTruthy()
    expect(manifest.description).toContain('AgentRig')
    expect(manifest['x-agentrig'].displayName).toBe('Demo Plugin')
  })
})
