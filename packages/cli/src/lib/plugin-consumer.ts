import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureDir, writeJsonFile } from './fs'
import { sha256Hex } from './hash'
import { resolvePluginSpec } from './plugin-resolver'
import { isFileish, isUrl, readSourceFile, resolvePluginFromRegistryRef } from './registry'
import { parseRegistryPluginSpec } from './registry-spec'
import { validatePluginPaths } from './trust'
import type { ResolvedPlugin } from './registry'
import type { RegistryRef } from './types'

function resolvePluginSourcePath(pluginDir: string, relativePath: string) {
  const normalized = path.normalize(relativePath)
  if (path.isAbsolute(normalized)) {
    throw new Error(`Absolute plugin source paths are not allowed: ${relativePath}`)
  }

  const destinationPath = path.resolve(pluginDir, normalized)
  const relativeToPluginDir = path.relative(pluginDir, destinationPath)
  if (relativeToPluginDir.startsWith('..') || path.isAbsolute(relativeToPluginDir)) {
    throw new Error(`Plugin source path escapes the plugin root: ${relativePath}`)
  }

  return destinationPath
}

function isExplicitPluginSpec(spec: string) {
  return isUrl(spec) || isFileish(spec) || spec.includes('/')
}

async function resolveDependencyPluginSpec(
  spec: string,
  parent: ResolvedPlugin,
  cwd: string,
  registries: RegistryRef[]
) {
  if (isExplicitPluginSpec(spec)) {
    return resolvePluginSpec(spec, cwd, registries)
  }

  const parsed = parseRegistryPluginSpec(spec)
  if (parent.registry) {
    return resolvePluginFromRegistryRef(parent.registry, parsed.plugin)
  }

  throw new Error(
    `Plugin "${parent.manifest.id}" dependency "${spec}" must be an explicit spec when the parent plugin does not come from a configured registry.`
  )
}

export type ResolvedPluginGraph = {
  requestedPlugin: ResolvedPlugin
  resolvedPlugins: ResolvedPlugin[]
}

export async function resolvePluginGraph(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
): Promise<ResolvedPluginGraph> {
  const resolvedPlugins: ResolvedPlugin[] = []
  const visited = new Set<string>()
  const sourcesByPluginId = new Map<string, string>()

  async function visit(nextSpec: string, parent?: ResolvedPlugin): Promise<ResolvedPlugin> {
    const resolved = parent
      ? await resolveDependencyPluginSpec(nextSpec, parent, cwd, registries)
      : await resolvePluginSpec(nextSpec, cwd, registries)

    const existingSource = sourcesByPluginId.get(resolved.manifest.id)
    if (existingSource && existingSource !== resolved.sourceLabel) {
      throw new Error(
        `Plugin "${resolved.manifest.id}" resolves from multiple sources (${existingSource}, ${resolved.sourceLabel}). Use one canonical source per dependency graph.`
      )
    }
    sourcesByPluginId.set(resolved.manifest.id, resolved.sourceLabel)

    const visitKey = `${resolved.sourceLabel}:${resolved.manifest.id}`
    if (visited.has(visitKey)) {
      return resolved
    }
    visited.add(visitKey)

    for (const dependencySpec of resolved.manifest.pluginDependencies ?? []) {
      await visit(dependencySpec, resolved)
    }

    resolvedPlugins.push(resolved)
    return resolved
  }

  const requestedPlugin = await visit(spec)
  return {
    requestedPlugin,
    resolvedPlugins,
  }
}

export async function materializeResolvedPluginGraph(graph: ResolvedPluginGraph) {
  const pluginsRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-source-'))

  for (const resolved of graph.resolvedPlugins) {
    const installFiles = resolved.installMetadata?.files ?? []
    const requiresDeliveryMetadata =
      resolved.source.type === 'url' || Boolean(resolved.registry)
    if (requiresDeliveryMetadata && installFiles.length === 0) {
      throw new Error(
        `Plugin "${resolved.manifest.id}" is missing required delivery install metadata.`
      )
    }
    const pathValidation = validatePluginPaths(installFiles)
    if (!pathValidation.valid) {
      throw new Error(
        `Plugin "${resolved.manifest.id}" contains invalid file paths:\n` +
          pathValidation.disallowed.map((target) => `  - ${target}`).join('\n')
      )
    }

    const pluginDir = path.join(pluginsRoot, resolved.manifest.id)
    await ensureDir(path.join(pluginDir, '.plugin'))
    await writeJsonFile(path.join(pluginDir, '.plugin', 'plugin.json'), {
      ...resolved.manifest,
      files: undefined,
    })

    for (const file of installFiles) {
      if (requiresDeliveryMetadata && !file.sha256) {
        throw new Error(
          `Plugin "${resolved.manifest.id}" is missing required sha256 for remote file "${file.path}".`
        )
      }
      const bytes = await readSourceFile(resolved.source, file.path)
      const actualSha = sha256Hex(bytes)
      if (file.sha256 && file.sha256 !== actualSha) {
        throw new Error(
          `Integrity check failed for ${resolved.manifest.id}:${file.path}\nExpected: ${file.sha256}\nActual:   ${actualSha}`
        )
      }

      const destinationPath = resolvePluginSourcePath(
        pluginDir,
        file.path
      )
      await ensureDir(path.dirname(destinationPath))
      await fs.writeFile(destinationPath, bytes)
      if (file.mode) {
        await fs.chmod(destinationPath, Number.parseInt(file.mode, 8))
      }
    }
  }

  return {
    resolved: graph.requestedPlugin,
    resolvedPlugins: graph.resolvedPlugins,
    pluginsRoot,
    pluginDir: path.join(pluginsRoot, graph.requestedPlugin.manifest.id),
  }
}

export async function materializeResolvedPlugin(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
) {
  const graph = await resolvePluginGraph(spec, cwd, registries)
  return materializeResolvedPluginGraph(graph)
}

export async function cleanupMaterializedPlugin(pluginsRoot: string) {
  await fs.rm(pluginsRoot, { recursive: true, force: true })
}
