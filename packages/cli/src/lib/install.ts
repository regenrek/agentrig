import path from 'node:path'
import { promises as fs } from 'node:fs'
import { chmodIfPossible, ensureDir, pathExists, writeTextFile } from './fs'
import { sha256Hex } from './hash'
import { renderTemplate } from './placeholders'
import { isNamespacedPack } from './namespace'
import type { Manifest, PackMeta, NamespacedRegistryConfig, TrustTier } from './types'
import {
  readSourceFile,
  resolvePackByName,
  resolvePackFromMetaSpec,
  resolvePackFromNamespacedRegistry,
  isUrl,
} from './registry'
import type { ResolvedPack } from './registry'
import {
  determineTrustTier,
  validateTargetPaths,
  formatInstallPlan,
  requiresConfirmation,
  isAllowedTargetPath,
} from './trust'

export type InstallOptions = {
  cwd: string
  skillsDir: string
  force?: boolean
  dryRun?: boolean
  registry?: string
  /** Skip confirmation prompts for unlisted sources */
  yes?: boolean
}

function assertPackMeta(meta: any): asserts meta is PackMeta {
  if (!meta || typeof meta !== 'object') throw new Error('Invalid pack meta: not an object')
  for (const key of ['name', 'title', 'description', 'version']) {
    if (typeof meta[key] !== 'string' || !meta[key]) throw new Error(`Invalid pack meta: missing ${key}`)
  }
  if (!Array.isArray(meta.files)) throw new Error('Invalid pack meta: files must be an array')
}

function parseMode(mode?: string): number | undefined {
  if (!mode) return undefined
  // treat as octal string, allow "755" or "0755"
  const clean = mode.startsWith('0') ? mode : `0${mode}`
  const parsed = Number.parseInt(clean, 8)
  return Number.isFinite(parsed) ? parsed : undefined
}

export type InstallConfig = {
  registries: { name: string; url: string }[]
  namespacedRegistries?: Record<string, NamespacedRegistryConfig>
}

export async function installPack(
  spec: string,
  config: InstallConfig,
  manifest: Manifest,
  opts: InstallOptions,
  _visited: Set<string> = new Set(),
): Promise<{ installed: string[]; skipped: string[]; trustTier?: TrustTier }> {
  const cwd = opts.cwd
  const skillsDir = opts.skillsDir

  let resolved: ResolvedPack

  // Determine how to resolve the pack
  if (isUrl(spec) || spec.endsWith('.json') || spec.startsWith('.') || spec.startsWith('/')) {
    // Direct URL or file path
    resolved = await resolvePackFromMetaSpec(spec, cwd)
  } else if (isNamespacedPack(spec) && config.namespacedRegistries) {
    // Namespaced pack: @namespace/pack-name
    resolved = await resolvePackFromNamespacedRegistry(spec, config.namespacedRegistries)
  } else {
    // Simple pack name from legacy registries
    resolved = await resolvePackByName(spec, config.registries, opts.registry)
  }

  // Determine trust tier
  const trustTier = resolved.trustTier ?? await determineTrustTier(
    spec,
    config.namespacedRegistries
  )

  const meta = resolved.meta
  assertPackMeta(meta)

  const visitKey = `${resolved.sourceLabel}:${meta.name}`
  if (_visited.has(visitKey)) {
    return { installed: [], skipped: [] }
  }
  _visited.add(visitKey)

  const pathValidation = validateTargetPaths(meta.files)
  if (!pathValidation.valid) {
    throw new Error(
      `Pack "${meta.name}" contains disallowed target paths:\n` +
        pathValidation.disallowed.map((p) => `  - ${p}`).join('\n')
    )
  }

  if (requiresConfirmation(trustTier) && !opts.yes) {
    const plan = formatInstallPlan(meta.name, meta.files, trustTier)
    throw new Error(
      `${plan}\n\n` +
        'This pack is from an unlisted source. Re-run with --yes to confirm install.'
    )
  }

  // Install dependencies first
  for (const dep of meta.rigDependencies ?? []) {
    await installPack(dep, config, manifest, opts, _visited)
  }

  const vars = {
    skillsDir,
  }

  const installedTargets: { target: string; sha256?: string; mode?: string }[] = []
  const installed: string[] = []
  const skipped: string[] = []

  for (const f of meta.files) {
    const targetRel = renderTemplate(f.target, vars)
    if (path.isAbsolute(targetRel)) {
      throw new Error(`Absolute target paths are not allowed: ${targetRel}`)
    }

    const targetAbs = path.resolve(cwd, targetRel)
    const relToCwd = path.relative(cwd, targetAbs)
    if (relToCwd.startsWith('..') || path.isAbsolute(relToCwd)) {
      throw new Error(`Target path escapes project directory: ${targetRel}`)
    }

    if (!isAllowedTargetPath(relToCwd)) {
      throw new Error(`Target path is not allowed: ${targetRel}`)
    }

    const bytes = await readSourceFile(resolved.source, f.path)
    const actualSha = sha256Hex(bytes)
    if (f.sha256 && f.sha256 !== actualSha) {
      throw new Error(`Integrity check failed for ${meta.name}:${f.path}\nExpected: ${f.sha256}\nActual:   ${actualSha}`)
    }

    const already = await pathExists(targetAbs)
    if (already && !opts.force) {
      skipped.push(targetRel)
      continue
    }

    if (!opts.dryRun) {
      await ensureDir(path.dirname(targetAbs))
      // write as utf-8 if it looks like text
      const asText = new TextDecoder().decode(bytes)
      await writeTextFile(targetAbs, asText)

      const mode = parseMode(f.mode)
      if (mode !== undefined) {
        await chmodIfPossible(targetAbs, mode)
      }
    }

    installed.push(targetRel)
    installedTargets.push({ target: targetRel, sha256: actualSha, mode: f.mode })
  }

  if (!opts.dryRun) {
    manifest.installed[meta.name] = {
      name: meta.name,
      version: meta.version,
      source: resolved.sourceLabel,
      installedAt: new Date().toISOString(),
      files: installedTargets,
    }
  }

  return { installed, skipped, trustTier }
}

export async function removePack(cwd: string, manifest: Manifest, packName: string) {
  const entry = manifest.installed[packName]
  if (!entry) return { removed: [], kept: [], missing: [] }

  const removed: string[] = []
  const kept: string[] = []
  const missing: string[] = []

  for (const f of entry.files) {
    const abs = path.join(cwd, f.target)
    if (!(await pathExists(abs))) {
      missing.push(f.target)
      continue
    }

    // safety: only delete if hash matches what we installed
    if (f.sha256) {
      const buf = await fs.readFile(abs)
      const actual = sha256Hex(buf)
      if (actual !== f.sha256) {
        kept.push(f.target)
        continue
      }
    }

    await fs.rm(abs, { force: true })
    removed.push(f.target)
  }

  delete manifest.installed[packName]
  return { removed, kept, missing }
}
