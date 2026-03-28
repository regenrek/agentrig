import path from 'node:path'
import { OFFICIAL_REGISTRY_URL, isFileish, isUrl, normalizeRegistryUrl } from './registry'
import { parseRegistryPackSpec } from './registry-spec'
import type { ResolvedPack } from './registry'
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
      metaUrl: new URL(trimmed).toString(),
    }
  }

  if (isFileish(trimmed)) {
    return {
      kind: 'file',
      metaPath: normalizeFileSpecPath(trimmed, cwd),
    }
  }

  const parsed = parseRegistryPackSpec(trimmed)
  if (!parsed.registry || parsed.registry === 'official') {
    return {
      kind: 'registry',
      registryUrl: normalizeRegistryUrl(getConfiguredOfficialRegistryUrl(registries)),
      packName: parsed.pack,
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
    packName: parsed.pack,
  }
}

export function getResolvedPackSpecIdentity(resolved: ResolvedPack): PluginInstallSpecIdentity {
  if (resolved.registry) {
    return {
      kind: 'registry',
      registryUrl: normalizeRegistryUrl(resolved.registry.url),
      packName: resolved.meta.name,
    }
  }

  if (resolved.sourceLabel.startsWith('url:')) {
    return {
      kind: 'url',
      metaUrl: new URL(resolved.sourceLabel.slice('url:'.length)).toString(),
    }
  }

  if (resolved.sourceLabel.startsWith('file:')) {
    return {
      kind: 'file',
      metaPath: path.normalize(resolved.sourceLabel.slice('file:'.length)),
    }
  }

  throw new Error(`Unable to determine install spec identity for ${resolved.meta.name}.`)
}

export function buildResolvedPackSpecIdentityMap(resolvedPacks: ResolvedPack[]) {
  return Object.fromEntries(
    resolvedPacks.map((resolved) => [resolved.meta.name, getResolvedPackSpecIdentity(resolved)])
  ) satisfies Record<string, PluginInstallSpecIdentity>
}

export function getPluginInstallSpecIdentityKey(identity: PluginInstallSpecIdentity) {
  switch (identity.kind) {
    case 'registry':
      return `registry:${identity.registryUrl}:${identity.packName}`
    case 'url':
      return `url:${identity.metaUrl}`
    case 'file':
      return `file:${identity.metaPath}`
  }
}

export function isSamePluginInstallSpecIdentity(
  left: PluginInstallSpecIdentity,
  right: PluginInstallSpecIdentity
) {
  return getPluginInstallSpecIdentityKey(left) === getPluginInstallSpecIdentityKey(right)
}
