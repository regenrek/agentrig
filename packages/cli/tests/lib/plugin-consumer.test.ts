import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { cleanupMaterializedPack, materializeResolvedPackGraph } from '../../src/lib/plugin-consumer'

describe('plugin-consumer', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })))
  })

  it('strips published registry pack prefixes when materializing plugin packs', async () => {
    const registryRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-consumer-'))
    tempPaths.push(registryRoot)

    const sourceFile = path.join(registryRoot, 'packs', 'core-pack', 'skills', 'shared', 'SKILL.md')
    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, '# core\n', 'utf-8')

    const materialized = await materializeResolvedPackGraph({
      requestedPack: {
        meta: {
          name: 'core-pack',
          title: 'Core Pack',
          description: 'Base pack.',
          version: '1.0.0',
          files: [
            {
              path: 'packs/core-pack/skills/shared/SKILL.md',
              target: '.codex/skills/shared/SKILL.md',
            },
          ],
        },
        source: { type: 'fs', baseDir: registryRoot },
        sourceLabel: 'registry:official',
        registry: { name: 'official', url: 'https://agentrig.ai/registry' },
      },
      resolvedPacks: [
        {
          meta: {
            name: 'core-pack',
            title: 'Core Pack',
            description: 'Base pack.',
            version: '1.0.0',
            files: [
              {
                path: 'packs/core-pack/skills/shared/SKILL.md',
                target: '.codex/skills/shared/SKILL.md',
              },
            ],
          },
          source: { type: 'fs', baseDir: registryRoot },
          sourceLabel: 'registry:official',
          registry: { name: 'official', url: 'https://agentrig.ai/registry' },
        },
      ],
    })

    tempPaths.push(materialized.packsRoot)
    expect(
      await fs.readFile(path.join(materialized.packsRoot, 'core-pack', 'skills', 'shared', 'SKILL.md'), 'utf-8')
    ).toBe('# core\n')
    await cleanupMaterializedPack(materialized.packsRoot)
  })
})
