import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureDir, writeJsonFile } from './fs'
import { sha256Hex } from './hash'
import { resolvePackSpec } from './pack-resolver'
import { isFileish, isUrl, readSourceFile, resolvePackFromRegistryRef } from './registry'
import { parseRegistryPackSpec } from './registry-spec'
import { validateTargetPaths } from './trust'
import type { ResolvedPack } from './registry'
import type { RegistryRef } from './types'

function assertPackMeta(meta: any): asserts meta is {
  name: string
  title: string
  description: string
  version: string
  files: Array<{ path: string; target: string; sha256?: string }>
  rigDependencies?: string[]
} {
  if (!meta || typeof meta !== 'object') throw new Error('Invalid pack meta: not an object')
  for (const key of ['name', 'title', 'description', 'version']) {
    if (typeof meta[key] !== 'string' || !meta[key]) throw new Error(`Invalid pack meta: missing ${key}`)
  }
  if (!Array.isArray(meta.files)) throw new Error('Invalid pack meta: files must be an array')
}

function resolvePackSourcePath(packDir: string, relativePath: string) {
  const normalized = path.normalize(relativePath)
  if (path.isAbsolute(normalized)) {
    throw new Error(`Absolute pack source paths are not allowed: ${relativePath}`)
  }

  const destinationPath = path.resolve(packDir, normalized)
  const relativeToPackDir = path.relative(packDir, destinationPath)
  if (relativeToPackDir.startsWith('..') || path.isAbsolute(relativeToPackDir)) {
    throw new Error(`Pack source path escapes the pack root: ${relativePath}`)
  }

  return destinationPath
}

function normalizeMaterializedPackFilePath(packName: string, relativePath: string) {
  const slashNormalized = relativePath.replace(/\\/g, '/')
  const publishedPrefix = `packs/${packName}/`
  if (slashNormalized.startsWith(publishedPrefix)) {
    return slashNormalized.slice(publishedPrefix.length)
  }
  return relativePath
}

function isExplicitPackSpec(spec: string) {
  return isUrl(spec) || isFileish(spec) || spec.includes('/')
}

async function resolveDependencyPackSpec(
  spec: string,
  parent: ResolvedPack,
  cwd: string,
  registries: RegistryRef[]
) {
  if (isExplicitPackSpec(spec)) {
    return resolvePackSpec(spec, cwd, registries)
  }

  const parsed = parseRegistryPackSpec(spec)
  if (parent.registry) {
    return resolvePackFromRegistryRef(parent.registry, parsed.pack)
  }

  throw new Error(
    `Pack "${parent.meta.name}" dependency "${spec}" must be an explicit spec when the parent pack does not come from a configured registry.`
  )
}

export type ResolvedPackGraph = {
  requestedPack: ResolvedPack
  resolvedPacks: ResolvedPack[]
}

export async function resolvePackGraph(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
): Promise<ResolvedPackGraph> {
  const resolvedPacks: ResolvedPack[] = []
  const visited = new Set<string>()
  const sourceByPackName = new Map<string, string>()

  async function visit(nextSpec: string, parent?: ResolvedPack): Promise<ResolvedPack> {
    const resolved = parent
      ? await resolveDependencyPackSpec(nextSpec, parent, cwd, registries)
      : await resolvePackSpec(nextSpec, cwd, registries)

    assertPackMeta(resolved.meta)

    const existingSource = sourceByPackName.get(resolved.meta.name)
    if (existingSource && existingSource !== resolved.sourceLabel) {
      throw new Error(
        `Pack "${resolved.meta.name}" resolves from multiple sources (${existingSource}, ${resolved.sourceLabel}). Use one canonical source per dependency graph.`
      )
    }
    sourceByPackName.set(resolved.meta.name, resolved.sourceLabel)

    const visitKey = `${resolved.sourceLabel}:${resolved.meta.name}`
    if (visited.has(visitKey)) {
      return resolved
    }
    visited.add(visitKey)

    for (const dependencySpec of resolved.meta.rigDependencies ?? []) {
      await visit(dependencySpec, resolved)
    }

    resolvedPacks.push(resolved)
    return resolved
  }

  const requestedPack = await visit(spec)
  return {
    requestedPack,
    resolvedPacks,
  }
}

export async function materializeResolvedPackGraph(graph: ResolvedPackGraph) {
  const packsRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-pack-'))

  for (const resolved of graph.resolvedPacks) {
    const pathValidation = validateTargetPaths(resolved.meta.files)
    if (!pathValidation.valid) {
      throw new Error(
        `Pack "${resolved.meta.name}" contains disallowed target paths:\n` +
          pathValidation.disallowed.map((target) => `  - ${target}`).join('\n')
      )
    }

    const packDir = path.join(packsRoot, resolved.meta.name)
    await ensureDir(packDir)
    await writeJsonFile(path.join(packDir, 'meta.json'), resolved.meta)

    for (const file of resolved.meta.files) {
      const bytes = await readSourceFile(resolved.source, file.path)
      const actualSha = sha256Hex(bytes)
      if (file.sha256 && file.sha256 !== actualSha) {
        throw new Error(
          `Integrity check failed for ${resolved.meta.name}:${file.path}\nExpected: ${file.sha256}\nActual:   ${actualSha}`
        )
      }

      const destinationPath = resolvePackSourcePath(
        packDir,
        normalizeMaterializedPackFilePath(resolved.meta.name, file.path)
      )
      await ensureDir(path.dirname(destinationPath))
      await fs.writeFile(destinationPath, bytes)
    }
  }

  return {
    resolved: graph.requestedPack,
    resolvedPacks: graph.resolvedPacks,
    packsRoot,
    packDir: path.join(packsRoot, graph.requestedPack.meta.name),
  }
}

export async function materializeResolvedPack(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
) {
  const graph = await resolvePackGraph(spec, cwd, registries)
  return materializeResolvedPackGraph(graph)
}

export async function cleanupMaterializedPack(packsRoot: string) {
  await fs.rm(packsRoot, { recursive: true, force: true })
}
