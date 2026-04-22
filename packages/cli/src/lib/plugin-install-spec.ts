import {
  normalizeRegistryUrl,
  resolveConfiguredRegistry,
} from './registry'
import { parseRegistryPluginSpec } from './registry-spec'
import type { ResolvedPlugin } from './registry'
import type {
  PluginInstallSpecIdentity,
  RegistryRef,
  VerifiedRegistryIdentity,
} from './types'
import type { ResolvedPluginInstallMetadata } from './plugin-providers/shared'

export function normalizePluginInstallSpecIdentity(
  spec: string,
  _cwd: string,
  registries: RegistryRef[]
): PluginInstallSpecIdentity {
  const parsed = parseRegistryPluginSpec(spec.trim())
  const registry = resolveConfiguredRegistry(parsed.registry, registries)
  return {
    kind: 'registry',
    registryAlias: registry.name,
    registryUrl: normalizeRegistryUrl(registry.url),
    pluginId: parsed.plugin,
    version: parsed.version,
  }
}

export function getResolvedPluginSpecIdentity(resolved: ResolvedPlugin): PluginInstallSpecIdentity {
  return {
    kind: 'registry',
    registryAlias: resolved.registry.name,
    registryUrl: normalizeRegistryUrl(resolved.registry.url),
    pluginId: resolved.manifest.id,
    version: resolved.manifest.version,
  }
}

export function getResolvedVerifiedRegistryIdentity(resolved: ResolvedPlugin): VerifiedRegistryIdentity {
  return {
    registryAlias: resolved.registryDocument.registry_alias,
    registryUrl: normalizeRegistryUrl(resolved.registry.url),
    sourceRepository: resolved.registryDocument.source_repository,
    contractVersion: resolved.registryDocument.contract_version,
    generatedAt: resolved.registryDocument.generated_at,
    signature: {
      algorithm: resolved.registryDocument.signature.algorithm,
      keyId: resolved.registryDocument.signature.key_id,
      signedDigest: resolved.registryDocument.signature.signed_digest,
    },
  }
}

export function buildResolvedPluginSpecIdentityMap(resolvedPlugins: ResolvedPlugin[]) {
  return Object.fromEntries(
    resolvedPlugins.map((resolved) => [resolved.manifest.id, getResolvedPluginSpecIdentity(resolved)])
  ) satisfies Record<string, PluginInstallSpecIdentity>
}

export function buildResolvedPluginInstallMetadataMap(resolvedPlugins: ResolvedPlugin[]) {
  return Object.fromEntries(
    resolvedPlugins.map((resolved) => [
      resolved.manifest.id,
      {
        specIdentity: getResolvedPluginSpecIdentity(resolved),
        registry: getResolvedVerifiedRegistryIdentity(resolved),
        snapshotDigest: resolved.snapshotDigest,
      } satisfies ResolvedPluginInstallMetadata,
    ])
  ) satisfies Record<string, ResolvedPluginInstallMetadata>
}

export function getPluginInstallSpecIdentityKey(identity: PluginInstallSpecIdentity) {
  return `registry:${identity.registryAlias}:${identity.pluginId}@${identity.version}`
}

export function isSamePluginInstallSpecIdentity(
  left: PluginInstallSpecIdentity,
  right: PluginInstallSpecIdentity
) {
  return getPluginInstallSpecIdentityKey(left) === getPluginInstallSpecIdentityKey(right)
}
