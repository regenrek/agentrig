import { afterAll, describe, expect, it } from 'vite-plus/test'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildRegistry } from '../../../../scripts/build-registry'

const tmpRoots: string[] = []

async function mkTmpDir() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-registry-'))
  tmpRoots.push(tmpRoot)
  return tmpRoot
}

afterAll(async () => {
  for (const root of tmpRoots) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

describe('buildRegistry', () => {
  it('rejects unsafe outputRoot', async () => {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const repoRoot = path.resolve(__dirname, '../../../..')
    const packsRoot = path.join(repoRoot, 'scripts', '__fixtures__', 'registry', 'packs')

    await expect(
      buildRegistry({
        repoRoot,
        packsRoot,
        outputRoot: repoRoot,
      }),
    ).rejects.toThrow(/Unsafe outputRoot|Refusing to delete/i)
  })

  it('rejects path traversal in pack files', async () => {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const repoRoot = path.resolve(__dirname, '../../../..')
    const packsRoot = path.join(repoRoot, 'scripts', '__fixtures__', 'registry', 'packs')
    const outputRoot = path.join(await mkTmpDir(), 'registry')

    await expect(
      buildRegistry({
        repoRoot,
        packsRoot,
        outputRoot,
      }),
    ).rejects.toThrow(/Invalid pack file path|Path traversal/i)
  })

  it('rejects symlink escape in pack files', async () => {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const repoRoot = path.resolve(__dirname, '../../../..')

    const tmpRoot = await mkTmpDir()
    const packsRoot = path.join(tmpRoot, 'packs')
    const packDir = path.join(packsRoot, 'evil-pack')
    const outsideDir = path.join(tmpRoot, 'outside')
    await fs.mkdir(packDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, 'secret.txt')
    await fs.writeFile(outsideFile, 'secret', 'utf-8')

    const symlinkPath = path.join(packDir, 'leak.txt')
    await fs.symlink(outsideFile, symlinkPath)

    await fs.writeFile(path.join(packDir, 'README.md'), '# hi\n', 'utf-8')
    await fs.writeFile(
      path.join(packDir, 'meta.json'),
      JSON.stringify(
        {
          name: 'evil-pack',
          title: 'Evil Pack',
          description: 'tests',
          version: '1.0.0',
          files: [{ path: 'leak.txt', target: '.codex/skills/evil/leak.txt' }],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    await expect(
      buildRegistry({
        repoRoot,
        packsRoot,
        outputRoot: path.join(tmpRoot, 'registry'),
      }),
    ).rejects.toThrow(/Symlink blocked/i)
  })
})
