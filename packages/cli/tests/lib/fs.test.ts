import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import {
  chmodIfPossible,
  ensureDir,
  pathExists,
  readJsonFile,
  readTextFile,
  removeIfExists,
  writeJsonFile,
  writeTextFile,
} from '../../src/lib/fs'

describe('fs utilities', () => {
  let baseDir = ''

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-fs-'))
  })

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true })
  })

  it('ensures directories exist', async () => {
    const dir = path.join(baseDir, 'nested', 'dir')
    await ensureDir(dir)
    expect(await pathExists(dir)).toBe(true)
  })

  it('reads and writes text files', async () => {
    const filePath = path.join(baseDir, 'note.txt')
    await writeTextFile(filePath, 'hello')
    await expect(readTextFile(filePath)).resolves.toBe('hello')
  })

  it('reads and writes json files', async () => {
    const jsonPath = path.join(baseDir, 'data.json')
    await writeJsonFile(jsonPath, { ok: true })
    await expect(readJsonFile<{ ok: boolean }>(jsonPath)).resolves.toEqual({ ok: true })
    const raw = await fs.readFile(jsonPath, 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('returns null for missing json files', async () => {
    const missing = path.join(baseDir, 'missing.json')
    await expect(readJsonFile(missing)).resolves.toBeNull()
  })

  it('removes files or directories if they exist', async () => {
    const dir = path.join(baseDir, 'remove', 'me')
    await ensureDir(dir)
    expect(await pathExists(dir)).toBe(true)
    await removeIfExists(path.join(baseDir, 'remove'))
    expect(await pathExists(dir)).toBe(false)
  })

  it('tries to chmod without throwing', async () => {
    const filePath = path.join(baseDir, 'mode.txt')
    await writeTextFile(filePath, 'mode')
    await expect(chmodIfPossible(filePath, 0o755)).resolves.toBeUndefined()
    expect(await pathExists(filePath)).toBe(true)
  })
})
