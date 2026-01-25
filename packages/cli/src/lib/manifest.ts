import path from 'node:path'
import { readJsonFile, writeJsonFile, ensureDir } from './fs'
import type { Manifest } from './types'

export function getManifestPath(cwd: string) {
  return path.join(cwd, '.agentrig', 'manifest.json')
}

export async function loadManifest(cwd: string): Promise<Manifest> {
  const p = getManifestPath(cwd)
  const m = await readJsonFile<Manifest>(p)
  if (m && m.schemaVersion === 1 && m.installed) return m
  return { schemaVersion: 1, installed: {} }
}

export async function saveManifest(cwd: string, manifest: Manifest) {
  const p = getManifestPath(cwd)
  await ensureDir(path.dirname(p))
  await writeJsonFile(p, manifest)
}
