import path from 'node:path'
import { OFFICIAL_REGISTRY_URL, isFileish, isUrl, normalizeRegistryUrl } from './registry'
import { parseRegistryPluginSpec } from './registry-spec'
import type { ResolvedPlugin } from './registry'
import type { PluginInstallSpecIdentity, RegistryRef } from './types'

function normalizeFileSpecPath(spec: string, cwd: string) {
  const slashNormalized = spec.trim().replace(/\\/g, '/')
  return path.normalize(path.resolve(cwd, slashNormalized))
}

function getConfiguredOfficialRegistryUrl(registries: RegistryRef[]) {
  return registries.find((entry) => entry.name === 'official')?.url ?? OFFICIAL_REGISTRY_URL
}

export function normalizePluginInstallSpecIdentity(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
): PluginInstallSpecIdentity {
  const trimmed = spec.trim()

  if (isUrl(trimmed)) {
    return {
      kind: 'url',
      manifestUrl: new URL(trimmed).toString(),
    }
  }

  if (isFileish(trimmed)) {
    const resolved = normalizeFileSpecPath(trimmed, cwd)
    const isDirectorySpec = !resolved.endsWith('.json')
    const manifestPath = isDirectorySpec
      ? path.join(resolved, '.plugin', 'plugin.json')
      : resolved
    return {
      kind: 'file',
      manifestPath,
    }
  }

  const parsed = parseRegistryPluginSpec(trimmed)
  if (!parsed.registry || parsed.registry === 'official') {
    return {
      kind: 'registry',
      registryUrl: normalizeRegistryUrl(getConfiguredOfficialRegistryUrl(registries)),
      pluginId: parsed.plugin,
    }
  }

  const registry = registries.find((entry) => entry.name === parsed.registry)
  if (!registry) {
    throw new Error(
      `Registry "${parsed.registry}" is not configured. Add it first with:\n` +
        `agentrig registry add ${parsed.registry} <baseUrl>`
    )
  }

  return {
    kind: 'registry',
    registryUrl: normalizeRegistryUrl(registry.url),
    pluginId: parsed.plugin,
  }
}

export function getResolvedPluginSpecIdentity(resolved: ResolvedPlugin): PluginInstallSpecIdentity {
  if (resolved.registry) {
    return {
      kind: 'registry',
      registryUrl: normalizeRegistryUrl(resolved.registry.url),
      pluginId: resolved.manifest.id,
    }
  }

  if (resolved.sourceLabel.startsWith('url:')) {
    return {
      kind: 'url',
      manifestUrl: new URL(resolved.sourceLabel.slice('url:'.length)).toString(),
    }
  }

  if (resolved.sourceLabel.startsWith('file:')) {
    return {
      kind: 'file',
      manifestPath: path.normalize(resolved.sourceLabel.slice('file:'.length)),
    }
  }

  throw new Error(`Unable to determine install spec identity for ${resolved.manifest.id}.`)
}

export function buildResolvedPluginSpecIdentityMap(resolvedPlugins: ResolvedPlugin[]) {
  return Object.fromEntries(
    resolvedPlugins.map((resolved) => [resolved.manifest.id, getResolvedPluginSpecIdentity(resolved)])
  ) satisfies Record<string, PluginInstallSpecIdentity>
}

export function getPluginInstallSpecIdentityKey(identity: PluginInstallSpecIdentity) {
  switch (identity.kind) {
    case 'registry':
      return `registry:${identity.registryUrl}:${identity.pluginId}`
    case 'url':
      return `url:${identity.manifestUrl}`
    case 'file':
      return `file:${identity.manifestPath}`
  }
}

export function isSamePluginInstallSpecIdentity(
  left: PluginInstallSpecIdentity,
  right: PluginInstallSpecIdentity
) {
  return getPluginInstallSpecIdentityKey(left) === getPluginInstallSpecIdentityKey(right)
}
