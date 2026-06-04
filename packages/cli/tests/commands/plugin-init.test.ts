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

  it('scaffolds canonical listing category into plugin manifests', async () => {
    const root = await tempRoot()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await run({
      args: {
        name: 'acme.review-tools',
        template: 'local',
        dir: root,
        title: 'Review Tools',
        description: 'Review workflow tools.',
        category: 'Development',
        author: 'Acme',
        force: false,
        help: false,
      },
    })

    const manifest = JSON.parse(
      await fs.readFile(path.join(root, 'acme.review-tools', '.plugin', 'plugin.json'), 'utf-8'),
    ) as { 'x-agentrig'?: { listing?: { category?: string } } }

    expect(manifest['x-agentrig']?.listing?.category).toBe('Development')
  })
})

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-init-'))
  tempDirs.push(dir)
  return dir
}
