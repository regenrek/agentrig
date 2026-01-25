import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import command from '../../src/commands/pack/create'

describe('command:pack:create', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('creates meta.json from a pack directory', async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-pack-create-'))
    const packDir = path.join(tempDir, 'pack')
    await fs.mkdir(path.join(packDir, 'skills'), { recursive: true })
    await fs.mkdir(path.join(packDir, 'scripts'), { recursive: true })

    await fs.writeFile(path.join(packDir, 'skills', 'skill.md'), 'skill', 'utf-8')
    await fs.writeFile(path.join(packDir, 'scripts', 'run.sh'), 'echo ok', 'utf-8')
    await fs.writeFile(path.join(packDir, 'README.md'), 'readme', 'utf-8')

    await run({
      args: {
        dir: packDir,
        version: '0.1.0',
        force: false,
        help: false,
      },
    })

    const metaPath = path.join(packDir, 'meta.json')
    const raw = await fs.readFile(metaPath, 'utf-8')
    const meta = JSON.parse(raw)

    expect(meta.name).toBe('pack')
    expect(meta.version).toBe('0.1.0')
    expect(meta.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'skills/skill.md',
          target: '{{skillsDir}}/skill.md',
        }),
        expect.objectContaining({
          path: 'scripts/run.sh',
          target: 'scripts/run.sh',
          mode: '755',
        }),
        expect.objectContaining({
          path: 'README.md',
          target: 'README.md',
        }),
      ])
    )
  })
})
