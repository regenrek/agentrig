import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  type ResolvedPluginGraph,
} from '../../src/lib/plugin-consumer'

function sha256Hex(input: string) {
  return createHash('sha256').update(Buffer.from(input)).digest('hex')
}

describe('plugin consumer registry materialization', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('materializes plugin-root relative files and preserves executable modes', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-source-'))
    tempDirs.push(sourceRoot)

    const pluginRoot = path.join(sourceRoot, 'plugins', 'demo', '1.2.3')
    const skillPath = path.join(pluginRoot, 'skills', 'demo', 'SKILL.md')
    const scriptPath = path.join(pluginRoot, 'scripts', 'run.sh')
    await fs.mkdir(path.dirname(skillPath), { recursive: true })
    await fs.mkdir(path.dirname(scriptPath), { recursive: true })
    await fs.writeFile(skillPath, '# Demo skill\n')
    await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho demo\n')
    await fs.chmod(scriptPath, 0o755)

    const graph = {
      requestedPlugin: {
        manifest: {
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.2.3',
          kind: 'agentrig:plugin',
configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        installMetadata: {
          files: [
            {
              path: 'skills/demo/SKILL.md',
              sha256: sha256Hex('# Demo skill\n'),
            },
            {
              path: 'scripts/run.sh',
              mode: '755',
              sha256: sha256Hex('#!/usr/bin/env bash\necho demo\n'),
            },
          ],
        },
        source: { type: 'fs', baseDir: pluginRoot as string },
        sourceLabel: `file:${sourceRoot}`,
        trustTier: 'official' as const,
      },
      resolvedPlugins: [] as any[],
    } satisfies ResolvedPluginGraph
    graph.resolvedPlugins = [graph.requestedPlugin]

    const materialized = await materializeResolvedPluginGraph(graph)
    tempDirs.push(materialized.pluginsRoot)

    const materializedPluginRoot = materialized.pluginDir
    const materializedSkill = path.join(materializedPluginRoot, 'skills', 'demo', 'SKILL.md')
    const materializedScript = path.join(materializedPluginRoot, 'scripts', 'run.sh')

    await expect(fs.stat(materializedSkill)).resolves.toBeDefined()
    await expect(fs.stat(materializedScript)).resolves.toBeDefined()
    await expect(fs.stat(path.join(materializedPluginRoot, '1.2.3'))).rejects.toThrow()

    const scriptStat = await fs.stat(materializedScript)
    expect(scriptStat.mode & 0o111).not.toBe(0)

    await cleanupMaterializedPlugin(materialized.pluginsRoot)
  })

  it('materializes files even when sha256 is absent', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-source-'))
    tempDirs.push(sourceRoot)

    const pluginRoot = path.join(sourceRoot, 'plugins', 'demo', '1.2.3')
    const skillPath = path.join(pluginRoot, 'skills', 'demo', 'SKILL.md')
    await fs.mkdir(path.dirname(skillPath), { recursive: true })
    await fs.writeFile(skillPath, '# Demo skill\n')

    const graph = {
      requestedPlugin: {
        manifest: {
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.2.3',
          kind: 'agentrig:plugin',
configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        installMetadata: { files: [{ path: 'skills/demo/SKILL.md' }] },
        source: { type: 'fs', baseDir: pluginRoot as string },
        sourceLabel: `file:${pluginRoot}`,
        trustTier: 'official' as const,
      },
      resolvedPlugins: [] as any[],
    } satisfies ResolvedPluginGraph
    graph.resolvedPlugins = [graph.requestedPlugin]

    const materialized = await materializeResolvedPluginGraph(graph)
    tempDirs.push(materialized.pluginsRoot)

    await expect(
      fs.readFile(path.join(materialized.pluginDir, 'skills', 'demo', 'SKILL.md'), 'utf-8')
    ).resolves.toBe('# Demo skill\n')
  })

  it('fails remote materialization when sha256 is absent', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-source-'))
    tempDirs.push(sourceRoot)

    const pluginRoot = path.join(sourceRoot, 'plugins', 'demo', '1.2.3')
    const skillPath = path.join(pluginRoot, 'skills', 'demo', 'SKILL.md')
    await fs.mkdir(path.dirname(skillPath), { recursive: true })
    await fs.writeFile(skillPath, '# Demo skill\n')

    const graph = {
      requestedPlugin: {
        manifest: {
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.2.3',
          kind: 'agentrig:plugin',
configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        installMetadata: { files: [{ path: 'skills/demo/SKILL.md' }] },
        source: { type: 'fs', baseDir: pluginRoot as string },
        sourceLabel: 'registry:official',
        trustTier: 'listed' as const,
        registry: { name: 'official', url: 'https://agentrig.ai/registry' },
      },
      resolvedPlugins: [] as any[],
    } satisfies ResolvedPluginGraph
    graph.resolvedPlugins = [graph.requestedPlugin]

    await expect(materializeResolvedPluginGraph(graph)).rejects.toThrow(/missing required sha256/i)
  })

  it('fails integrity validation when install metadata sha256 is wrong', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-plugin-source-'))
    tempDirs.push(sourceRoot)

    const pluginRoot = path.join(sourceRoot, 'plugins', 'demo', '1.2.3')
    const skillPath = path.join(pluginRoot, 'skills', 'demo', 'SKILL.md')
    await fs.mkdir(path.dirname(skillPath), { recursive: true })
    await fs.writeFile(skillPath, '# Demo skill\n')

    const graph = {
      requestedPlugin: {
        manifest: {
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.2.3',
          kind: 'agentrig:plugin',
configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        installMetadata: {
          files: [{ path: 'skills/demo/SKILL.md', sha256: 'a'.repeat(64) }],
        },
        source: { type: 'fs', baseDir: pluginRoot as string },
        sourceLabel: `file:${pluginRoot}`,
        trustTier: 'official' as const,
      },
      resolvedPlugins: [] as any[],
    } satisfies ResolvedPluginGraph
    graph.resolvedPlugins = [graph.requestedPlugin]

    await expect(materializeResolvedPluginGraph(graph)).rejects.toThrow(/Integrity check failed/)
  })
})
