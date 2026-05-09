import {
  normalizeRegistryUrl,
  resolveConfiguredRegistry,
  resolveInstallBundleFromConvex,
  installBundleSnapshotDigest,
} from './registry'
import {
  parseRegistryArtifactSpec,
  parseRegistryPluginSpec,
  type ParsedRegistryArtifactKind,
} from './registry-spec'
import type { ResolvedPlugin, ResolvedStandaloneArtifact } from './registry'
import type { InstallBundle } from '@agentrig/sdk'
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
  if (!parsed.version) {
    throw new Error(`Install ref "${spec}" must be resolved before creating a concrete install identity.`)
  }
  const registry = resolveConfiguredRegistry(parsed.registry, registries)
  return {
    kind: 'registry',
    registryAlias: registry.name,
    registryUrl: normalizeRegistryUrl(registry.url),
    pluginId: parsed.plugin,
    version: parsed.version,
  }
}

export async function resolvePluginInstallSpecIdentity(
  spec: string,
  _cwd: string,
  registries: RegistryRef[]
): Promise<PluginInstallSpecIdentity> {
  const parsed = parseRegistryPluginSpec(spec.trim())
  if (parsed.version) return normalizePluginInstallSpecIdentity(spec, _cwd, registries)
  const registry = resolveConfiguredRegistry(parsed.registry, registries)
  const resolved = await resolveInstallBundleFromConvex(registry, parsed.plugin)
  return getResolvedPluginSpecIdentity(resolved)
}

export function getResolvedPluginSpecIdentity(resolved: ResolvedPlugin): PluginInstallSpecIdentity {
  const alias = resolved.listing.registryAlias ?? 'agentrig'
  return {
    kind: 'registry',
    registryAlias: alias,
    registryUrl: marketplaceUrlForBundle(resolved),
    pluginId: resolved.listing.artifactId,
    version: resolved.listing.version,
  }
}

export function normalizeRegistryArtifactInstallSpecIdentity(
  spec: string,
  artifactKind: ParsedRegistryArtifactKind,
  _cwd: string,
  registries: RegistryRef[]
): RegistryArtifactInstallSpecIdentity {
  const parsed = parseRegistryArtifactSpec(spec.trim(), artifactKind)
  if (!parsed.version) {
    throw new Error(`Install ref "${spec}" must be resolved before creating a concrete install identity.`)
  }
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

export async function resolveRegistryArtifactInstallSpecIdentity(
  spec: string,
  artifactKind: ParsedRegistryArtifactKind,
  _cwd: string,
  registries: RegistryRef[]
): Promise<RegistryArtifactInstallSpecIdentity> {
  const parsed = parseRegistryArtifactSpec(spec.trim(), artifactKind)
  if (parsed.version) return normalizeRegistryArtifactInstallSpecIdentity(spec, artifactKind, _cwd, registries)
  const registry = resolveConfiguredRegistry(parsed.registry, registries)
  const resolved = await resolveInstallBundleFromConvex(registry, parsed.artifact)
  return getResolvedRegistryArtifactSpecIdentity(resolved)
}

export function getResolvedRegistryArtifactSpecIdentity(resolved: ResolvedStandaloneArtifact): RegistryArtifactInstallSpecIdentity {
  const alias = resolved.listing.registryAlias ?? 'agentrig'
  return {
    kind: 'registry-artifact',
    registryAlias: alias,
    registryUrl: marketplaceUrlForBundle(resolved),
    artifactKind: resolved.listing.kind as ParsedRegistryArtifactKind,
    artifactId: resolved.listing.artifactId,
    version: resolved.listing.version,
  }
}

export function getResolvedVerifiedRegistryIdentity(resolved: ResolvedPlugin | ResolvedStandaloneArtifact): VerifiedRegistryIdentity {
  if (!resolved.listing.registryAlias && !resolved.listing.registrySourceRepository && !resolved.listing.registrySnapshotDigest) {
    throw new Error(`Marketplace listing "${resolved.listing.artifactId}" does not include verified registry metadata.`)
  }
  return {
    registryAlias: resolved.listing.registryAlias ?? 'agentrig',
    registryUrl: marketplaceUrlForBundle(resolved),
    sourceRepository: resolved.listing.registrySourceRepository ?? resolved.source.url ?? 'https://agentrig.ai',
    contractVersion: '1',
    generatedAt: new Date(resolved.listing.updatedAt).toISOString(),
    signature: {
      algorithm: 'install-bundle-file-list-sha256',
      keyId: 'agentrig-marketplace-listing',
      signedDigest: installBundleSnapshotDigest(resolved),
    },
  }
}

export function buildResolvedPluginSpecIdentityMap(resolvedPlugins: ResolvedPlugin[]) {
  return Object.fromEntries(
    resolvedPlugins.map((resolved) => [resolved.listing.artifactId, getResolvedPluginSpecIdentity(resolved)])
  ) satisfies Record<string, PluginInstallSpecIdentity>
}

export function buildResolvedPluginInstallMetadataMap(resolvedPlugins: ResolvedPlugin[]) {
  return Object.fromEntries(
    resolvedPlugins.map((resolved) => [
      resolved.listing.artifactId,
      {
        specIdentity: getResolvedPluginSpecIdentity(resolved),
        registry: getResolvedVerifiedRegistryIdentity(resolved),
        snapshotDigest: installBundleSnapshotDigest(resolved),
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

function marketplaceUrlForBundle(bundle: InstallBundle) {
  return normalizeRegistryUrl(bundle.source.url ?? 'https://agentrig.ai')
}
