import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import command from '../../src/commands/pack/claude-marketplace'

describe('command:pack:claude-marketplace', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('exports packs as a Claude marketplace', async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-marketplace-'))
    const packsRoot = path.join(tempDir, 'packs')
    const packDir = path.join(packsRoot, 'sample-pack')
    await fs.mkdir(path.join(packDir, 'commands'), { recursive: true })
    await fs.mkdir(path.join(packDir, 'agents'), { recursive: true })

    const meta = {
      name: 'sample-pack',
      title: 'Sample Pack',
      description: 'Sample description',
      version: '1.0.0',
      tags: ['demo'],
    }
    await fs.writeFile(path.join(packDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8')
    await fs.writeFile(path.join(packDir, 'commands', 'cmd.txt'), 'cmd', 'utf-8')
    await fs.writeFile(path.join(packDir, 'agents', 'agent.txt'), 'agent', 'utf-8')

    const outRoot = path.join(tempDir, 'out')

    await command.run({
      args: {
        packsDir: packsRoot,
        out: outRoot,
        marketplaceName: 'demo-market',
        ownerName: 'Demo Owner',
        ownerEmail: 'owner@example.com',
        pluginPrefix: 'ag-',
        clean: true,
        config: undefined,
        help: false,
      },
    })

    const pluginDir = path.join(outRoot, 'plugins', 'ag-sample-pack')
    const pluginManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')
    const marketplaceManifestPath = path.join(outRoot, '.claude-plugin', 'marketplace.json')

    const pluginManifest = JSON.parse(await fs.readFile(pluginManifestPath, 'utf-8'))
    expect(pluginManifest.name).toBe('ag-sample-pack')
    expect(pluginManifest.commands).toEqual(['./commands'])
    expect(pluginManifest.agents).toEqual(['./agents'])

    const marketplaceManifest = JSON.parse(await fs.readFile(marketplaceManifestPath, 'utf-8'))
    expect(marketplaceManifest.name).toBe('demo-market')
    expect(marketplaceManifest.owner.name).toBe('Demo Owner')
    expect(marketplaceManifest.plugins).toHaveLength(1)
    expect(marketplaceManifest.plugins[0].name).toBe('ag-sample-pack')
  })
})
