import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import command from '../../src/commands/plugin/init'

const tempDirs: string[] = []

describe('command:plugin:init', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('scaffolds a portable manifest without registry listing metadata', async () => {
    const root = await tempRoot()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run({
      args: {
        name: 'acme.review-tools',
        template: 'local',
        dir: root,
        title: 'Review Tools',
        description: 'Review workflow tools.',
        author: 'Acme',
        force: false,
        help: false,
      },
    })

    const manifest = JSON.parse(
      await fs.readFile(path.join(root, 'acme.review-tools', 'plugin.json'), 'utf-8'),
    ) as { extensions?: { 'ai.agentrig'?: Record<string, unknown> } }

    expect(manifest.extensions?.['ai.agentrig']).toEqual({ displayName: 'Review Tools' })
  })
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-init-'))
  tempDirs.push(dir)
  return dir
}
