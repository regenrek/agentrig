import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureDir } from './fs'
import { sha256Hex } from './hash'
import { resolvePluginSpec } from './plugin-resolver'
import {
  readSourceFile,
  registryArtifactSourcePath,
  resolvePluginFromRegistryRef,
} from './registry'
import { validatePluginPaths } from './trust'
import type { ResolvedPlugin, ResolvedStandaloneArtifact } from './registry'
import type { RegistryRef, RegistryVersionDependency } from '@agentrig/sdk'

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

async function resolveDependencyPlugin(
  dependency: RegistryVersionDependency,
  parent: ResolvedPlugin,
  _cwd: string,
  _registries: RegistryRef[]
) {
  return resolvePluginFromRegistryRef(parent.registry, dependency.plugin, dependency.version)
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

  async function visit(
    next: string | RegistryVersionDependency,
    parent?: ResolvedPlugin
  ): Promise<ResolvedPlugin> {
    const resolved = parent
      ? await resolveDependencyPlugin(next as RegistryVersionDependency, parent, cwd, registries)
      : await resolvePluginSpec(next as string, cwd, registries)

    const existingSource = sourcesByPluginId.get(resolved.manifest.id)
    if (existingSource && existingSource !== resolved.sourceLabel) {
      throw new Error(
        `Plugin "${resolved.manifest.id}" resolves from multiple versions (${existingSource}, ${resolved.sourceLabel}). Use one exact version per dependency graph.`
      )
    }
    sourcesByPluginId.set(resolved.manifest.id, resolved.sourceLabel)

    const visitKey = `${resolved.sourceLabel}:${resolved.manifest.id}`
    if (visited.has(visitKey)) {
      return resolved
    }
    visited.add(visitKey)

    for (const dependency of resolved.lockArtifact.dependencies) {
      await visit(dependency, resolved)
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
    const installFiles = resolved.lockArtifact.file_digests
    if (installFiles.length === 0) {
      throw new Error(
        `Plugin "${resolved.manifest.id}" is missing required snapshot file digests.`
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
    await ensureDir(pluginDir)

    for (const file of installFiles) {
      const bytes = await readSourceFile(resolved.source, file.path)
      const actualDigest = `sha256:${sha256Hex(bytes)}`
      if (file.digest !== actualDigest) {
        throw new Error(
          `Digest mismatch for ${resolved.manifest.id}:${file.path}\nExpected: ${file.digest}\nActual:   ${actualDigest}`
        )
      }

      const destinationPath = resolvePluginSourcePath(
        pluginDir,
        file.path
      )
      await ensureDir(path.dirname(destinationPath))
      await fs.writeFile(destinationPath, bytes)
    }
  }

  return {
    resolved: graph.requestedPlugin,
    resolvedPlugins: graph.resolvedPlugins,
    pluginsRoot,
    pluginDir: path.join(pluginsRoot, graph.requestedPlugin.manifest.id),
  }
}

export async function materializeResolvedStandaloneArtifact(resolved: ResolvedStandaloneArtifact) {
  const artifactsRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-artifact-source-'))
  const artifactDir = path.join(artifactsRoot, resolved.artifactId)
  await ensureDir(artifactDir)
  const sourceRoot = registryArtifactSourcePath(resolved.artifactKind, resolved.artifactId)

  for (const file of resolved.lockArtifact.file_digests) {
    const bytes = await readSourceFile(resolved.source, file.path)
    const actualDigest = `sha256:${sha256Hex(bytes)}`
    if (file.digest !== actualDigest) {
      throw new Error(
        `Digest mismatch for ${resolved.artifactId}:${file.path}\nExpected: ${file.digest}\nActual:   ${actualDigest}`
      )
    }

    const destinationPath = resolvePluginSourcePath(
      artifactDir,
      `${sourceRoot}/${file.path}`
    )
    await ensureDir(path.dirname(destinationPath))
    await fs.writeFile(destinationPath, bytes)
  }

  return {
    artifactsRoot,
    artifactDir,
    sourceRoot,
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
