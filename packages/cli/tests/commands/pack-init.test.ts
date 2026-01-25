import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import command from '../../src/commands/pack/init'
import packCommand from '../../src/commands/pack'

describe('command:pack:init', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('scaffolds a pack from a local template', async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-pack-init-'))
    const templateRoot = path.join(tempDir, 'template-src')
    const templateDir = path.join(templateRoot, 'template')
    await fs.mkdir(path.join(templateDir, 'skills', '__PACK_NAME__'), { recursive: true })

    await fs.writeFile(
      path.join(templateDir, 'README.md'),
      'Name: __PACK_NAME__ Title: __PACK_TITLE__ Author: __PACK_AUTHOR__',
      'utf-8'
    )
    await fs.writeFile(
      path.join(templateDir, 'skills', '__PACK_NAME__', 'SKILL.md'),
      '__PACK_DESCRIPTION__',
      'utf-8'
    )
    await fs.writeFile(path.join(templateDir, '_gitignore'), 'dist\n', 'utf-8')

    await command.run({
      args: {
        name: 'test-pack',
        template: `file:${templateRoot}`,
        dir: tempDir,
        title: undefined,
        description: 'Test pack description',
        author: 'Me',
        force: false,
        help: false,
      },
    })

    const destDir = path.join(tempDir, 'test-pack')
    const readme = await fs.readFile(path.join(destDir, 'README.md'), 'utf-8')
    expect(readme).toContain('Name: test-pack')
    expect(readme).toContain('Title: Test Pack')
    expect(readme).toContain('Author: Me')

    const skillPath = path.join(destDir, 'skills', 'test-pack', 'SKILL.md')
    const skillContent = await fs.readFile(skillPath, 'utf-8')
    expect(skillContent).toBe('Test pack description')

    const gitignorePath = path.join(destDir, '.gitignore')
    await expect(fs.access(gitignorePath)).resolves.toBeUndefined()
  })

  it('shows usage for pack wrapper', async () => {
    await packCommand.run({ args: { help: false } })
  })
})
