import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/lib/hash'
import type { Manifest, PackMeta } from '../../src/lib/types'
import { installPack, removePack } from '../../src/lib/install'

type PackSetup = {
  rootDir: string
  packDir: string
  projectDir: string
  metaPath: string
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

async function setupPack(meta: PackMeta, files: Record<string, string>): Promise<PackSetup> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-install-'))
  const packDir = path.join(rootDir, 'pack')
  const projectDir = path.join(rootDir, 'project')
  await fs.mkdir(packDir, { recursive: true })
  await fs.mkdir(projectDir, { recursive: true })

  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(packDir, relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf-8')
  }

  const metaPath = path.join(packDir, 'pack.json')
  await writeJson(metaPath, meta)
  return { rootDir, packDir, projectDir, metaPath }
}

async function cleanupPack(setup: PackSetup | null) {
  if (!setup) return
  await fs.rm(setup.rootDir, { recursive: true, force: true })
}

describe('install', () => {
  let currentSetup: PackSetup | null = null

  afterEach(async () => {
    await cleanupPack(currentSetup)
    currentSetup = null
  })

  it('installs files from a local meta spec', async () => {
    const fileContent = 'hello world'
    const fileHash = sha256Hex(new TextEncoder().encode(fileContent))
    const meta: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [
        {
          path: 'files/core.txt',
          target: '{{skillsDir}}/core.txt',
          mode: '755',
          sha256: fileHash,
        },
      ],
    }

    currentSetup = await setupPack(meta, { 'files/core.txt': fileContent })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    const result = await installPack(currentSetup.metaPath, { registries: [] }, manifest, {
      cwd: currentSetup.projectDir,
      skillsDir: '.codex/skills',
      yes: true,
    })

    expect(result.installed).toEqual(['.codex/skills/core.txt'])
    const installedPath = path.join(currentSetup.projectDir, '.codex/skills/core.txt')
    expect(await fs.readFile(installedPath, 'utf-8')).toBe(fileContent)
    expect(manifest.installed.core).toBeDefined()
    expect(manifest.installed.core.files).toHaveLength(1)
  })

  it('skips existing files unless forced', async () => {
    const fileContent = 'existing'
    const meta: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: '{{skillsDir}}/core.txt' }],
    }
    currentSetup = await setupPack(meta, { 'files/core.txt': fileContent })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    await installPack(currentSetup.metaPath, { registries: [] }, manifest, {
      cwd: currentSetup.projectDir,
      skillsDir: '.codex/skills',
      yes: true,
    })

    const result = await installPack(currentSetup.metaPath, { registries: [] }, manifest, {
      cwd: currentSetup.projectDir,
      skillsDir: '.codex/skills',
      yes: true,
    })

    expect(result.installed).toEqual([])
    expect(result.skipped).toEqual(['.codex/skills/core.txt'])
  })

  it('honors dry-run mode without writing files or manifest', async () => {
    const meta: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: '{{skillsDir}}/core.txt' }],
    }
    currentSetup = await setupPack(meta, { 'files/core.txt': 'dry' })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    const result = await installPack(currentSetup.metaPath, { registries: [] }, manifest, {
      cwd: currentSetup.projectDir,
      skillsDir: '.codex/skills',
      dryRun: true,
      yes: true,
    })

    expect(result.installed).toEqual(['.codex/skills/core.txt'])
    const installedPath = path.join(currentSetup.projectDir, '.codex/skills/core.txt')
    await expect(fs.access(installedPath)).rejects.toThrow()
    expect(manifest.installed.core).toBeUndefined()
  })

  it('requires confirmation for unlisted sources', async () => {
    const meta: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: '{{skillsDir}}/core.txt' }],
    }
    currentSetup = await setupPack(meta, { 'files/core.txt': 'content' })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '.codex/skills',
        yes: false,
      })
    ).rejects.toThrow('This pack is from an unlisted source')
  })

  it('validates pack meta content', async () => {
    const meta = {
      name: 'core',
      description: 'Core pack',
      version: '1.0.0',
      files: [],
    } as unknown as PackMeta
    currentSetup = await setupPack(meta, {})
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '.codex/skills',
        yes: true,
      })
    ).rejects.toThrow('Invalid pack meta: missing title')
  })

  it('rejects invalid target paths', async () => {
    const meta: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: 'etc/passwd' }],
    }
    currentSetup = await setupPack(meta, { 'files/core.txt': 'bad' })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '.codex/skills',
        yes: true,
      })
    ).rejects.toThrow('contains disallowed target paths')
  })

  it('rejects absolute target paths after rendering', async () => {
    const metaAbs: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: '{{skillsDir}}/core.txt' }],
    }
    currentSetup = await setupPack(metaAbs, { 'files/core.txt': 'bad' })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }
    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '/abs',
        yes: true,
      })
    ).rejects.toThrow('Absolute target paths are not allowed')
  })

  it('rejects escaping or disallowed target paths after rendering', async () => {
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    const metaEsc: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: '{{skillsDir}}/../../../../etc/passwd' }],
    }
    currentSetup = await setupPack(metaEsc, { 'files/core.txt': 'bad' })
    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '.codex/skills',
        yes: true,
      })
    ).rejects.toThrow('Target path escapes project directory')

    await cleanupPack(currentSetup)
    const metaDisallowed: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [{ path: 'files/core.txt', target: '{{skillsDir}}/../../secret.txt' }],
    }
    currentSetup = await setupPack(metaDisallowed, { 'files/core.txt': 'bad' })
    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '.codex/skills',
        yes: true,
      })
    ).rejects.toThrow('Target path is not allowed')
  })

  it('rejects mismatched file hashes', async () => {
    const meta: PackMeta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [
        {
          path: 'files/core.txt',
          target: '{{skillsDir}}/core.txt',
          sha256: 'deadbeef',
        },
      ],
    }
    currentSetup = await setupPack(meta, { 'files/core.txt': 'content' })
    const manifest: Manifest = { schemaVersion: 1, installed: {} }

    await expect(
      installPack(currentSetup.metaPath, { registries: [] }, manifest, {
        cwd: currentSetup.projectDir,
        skillsDir: '.codex/skills',
        yes: true,
      })
    ).rejects.toThrow('Integrity check failed')
  })

  it('removes installed files safely', async () => {
    const manifest: Manifest = {
      schemaVersion: 1,
      installed: {},
    }

    const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-remove-'))
    const projectDir = path.join(rootDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const goodPath = path.join(projectDir, '.codex/skills/good.txt')
    const keepPath = path.join(projectDir, '.codex/skills/keep.txt')
    await fs.mkdir(path.dirname(goodPath), { recursive: true })
    await fs.writeFile(goodPath, 'good', 'utf-8')
    await fs.writeFile(keepPath, 'changed', 'utf-8')

    const goodHash = sha256Hex(new TextEncoder().encode('good'))

    manifest.installed.core = {
      name: 'core',
      version: '1.0.0',
      source: 'file:pack.json',
      installedAt: new Date().toISOString(),
      files: [
        { target: '.codex/skills/good.txt', sha256: goodHash },
        { target: '.codex/skills/keep.txt', sha256: 'different' },
        { target: '.codex/skills/missing.txt', sha256: goodHash },
      ],
    }

    const result = await removePack(projectDir, manifest, 'core')
    expect(result.removed).toEqual(['.codex/skills/good.txt'])
    expect(result.kept).toEqual(['.codex/skills/keep.txt'])
    expect(result.missing).toEqual(['.codex/skills/missing.txt'])
    expect(manifest.installed.core).toBeUndefined()

    await fs.rm(rootDir, { recursive: true, force: true })
  })

  it('no-ops when removing unknown packs', async () => {
    const manifest: Manifest = { schemaVersion: 1, installed: {} }
    const result = await removePack('/repo', manifest, 'missing')
    expect(result).toEqual({ removed: [], kept: [], missing: [] })
  })
})
