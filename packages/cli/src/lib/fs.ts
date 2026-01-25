import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function pathExists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

export async function readTextFile(p: string) {
  return fs.readFile(p, 'utf-8')
}

export async function writeTextFile(p: string, content: string) {
  await ensureDir(path.dirname(p))
  await fs.writeFile(p, content, 'utf-8')
}

export async function readJsonFile<T>(p: string): Promise<T | null> {
  if (!(await pathExists(p))) return null
  const raw = await fs.readFile(p, 'utf-8')
  return JSON.parse(raw) as T
}

export async function writeJsonFile(p: string, data: unknown) {
  await ensureDir(path.dirname(p))
  await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export async function removeIfExists(p: string) {
  await fs.rm(p, { recursive: true, force: true })
}

export async function chmodIfPossible(p: string, mode: number) {
  try {
    await fs.chmod(p, mode)
  } catch {
    // noop on windows or restricted fs
  }
}
