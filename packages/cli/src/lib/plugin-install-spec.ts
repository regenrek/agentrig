import {
  normalizeRegistryUrl,
  resolveConfiguredRegistry,
} from './registry'
import {
  parseRegistryArtifactSpec,
  parseRegistryPluginSpec,
  type ParsedRegistryArtifactKind,
} from './registry-spec'
import type { ResolvedPlugin, ResolvedStandaloneArtifact } from './registry'
import type {
  PluginInstallSpecIdentity,
  RegistryRef,
  VerifiedRegistryIdentity,
} from './types'
import type { ResolvedPluginInstallMetadata } from './plugin-providers/shared'

type RegistryArtifactInstallSpecIdentity = Extract<PluginInstallSpecIdentity, { kind: 'registry-artifact' }>

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

export function normalizeRegistryArtifactInstallSpecIdentity(
  spec: string,
  artifactKind: ParsedRegistryArtifactKind,
  _cwd: string,
  registries: RegistryRef[]
): RegistryArtifactInstallSpecIdentity {
  const parsed = parseRegistryArtifactSpec(spec.trim(), artifactKind)
  const registry = resolveConfiguredRegistry(parsed.registry, registries)
  return {
    kind: 'registry-artifact',
    registryAlias: registry.name,
    registryUrl: normalizeRegistryUrl(registry.url),
    artifactKind: parsed.artifactKind,
    artifactId: parsed.artifact,
    version: parsed.version,
  }
}

export function getResolvedRegistryArtifactSpecIdentity(resolved: ResolvedStandaloneArtifact): RegistryArtifactInstallSpecIdentity {
  return {
    kind: 'registry-artifact',
    registryAlias: resolved.registry.name,
    registryUrl: normalizeRegistryUrl(resolved.registry.url),
    artifactKind: resolved.artifactKind,
    artifactId: resolved.artifactId,
    version: resolved.manifest.version,
  }
}

export function getResolvedVerifiedRegistryIdentity(resolved: ResolvedPlugin | ResolvedStandaloneArtifact): VerifiedRegistryIdentity {
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
  if (identity.kind === 'external-repo') {
    const repo = identity.repoUrl || [identity.owner, identity.repo].filter(Boolean).join('/') || 'local'
    const revision = identity.commitSha || identity.ref || identity.scanDigest
    const picked = identity.pickedSignalPaths.join(',')
    return `external-repo:${repo}:${revision}:${identity.subdir ?? ''}:${identity.pluginId}@${identity.version}:${picked}`
  }
  if (identity.kind === 'registry-artifact') {
    return `registry-artifact:${identity.registryAlias}:${identity.registryUrl}:${identity.artifactKind}:${identity.artifactId}@${identity.version}`
  }
  return `registry:${identity.registryAlias}:${identity.pluginId}@${identity.version}`
}

export function isSamePluginInstallSpecIdentity(
  left: PluginInstallSpecIdentity,
  right: PluginInstallSpecIdentity
) {
  return getPluginInstallSpecIdentityKey(left) === getPluginInstallSpecIdentityKey(right)
}
