import type {
  CapabilityId,
  PluginManifest,
  PluginProfile,
  RegistryInstallability,
  TrustTier,
} from '../marketplace-listing'
import { PROVIDER_TARGETS } from '../marketplace-listing'
import type { ProviderCompatState } from '../repo-scan/types'

export const CAPABILITY_RESOLUTION_TARGETS = PROVIDER_TARGETS

export type CapabilityTarget = (typeof CAPABILITY_RESOLUTION_TARGETS)[number]
export type CapabilityProviderCompatibilityState = ProviderCompatState | 'unknown'
export type CapabilityProviderCompatibility = Record<CapabilityTarget, CapabilityProviderCompatibilityState>

export type AgentRigPluginExtension = NonNullable<PluginManifest['x-agentrig']>
export type AgentRigProvidedCapability = NonNullable<AgentRigPluginExtension['providesCapabilities']>[string]
export type AgentRigRequiredCapability = NonNullable<AgentRigPluginExtension['requiredCapabilities']>[string]
export type AgentRigVerification = NonNullable<AgentRigPluginExtension['verification']>

export type CapabilityProviderInstallConstraints = Partial<Record<CapabilityTarget, string[]>> & {
  common?: string[]
}

export type CapabilityPluginRecord = {
  ref: string
  manifest: PluginManifest
  trustTier: TrustTier
  installability: RegistryInstallability
  version?: string
  registryAlias?: string
  registryRef?: string
  snapshotDigest?: string
  installConstraints?: CapabilityProviderInstallConstraints
}

export type CapabilityPluginLoader = {
  loadPlugin(ref: string): Promise<CapabilityPluginRecord | null | undefined>
  findCapabilityProviders?: (capability: CapabilityId) => Promise<readonly CapabilityPluginRecord[]>
}

export type CapabilityResolveInput = {
  pluginRef: string
  loader: CapabilityPluginLoader
  now?: Date | number | string
}

export type CapabilityPluginRefParts = {
  raw: string
  name: string
  registryAlias?: string
  requestedVersion?: string
}

export type CapabilityResolvedPlugin = {
  ref: string
  plugin: string
  version?: string
  profile?: PluginProfile
  trustTier: TrustTier
  installability: RegistryInstallability
  registryAlias?: string
  registryRef?: string
  snapshotDigest?: string
}

export type CapabilityDependencyNode = CapabilityResolvedPlugin & {
  dependencyRef?: string
  alreadyResolved?: boolean
  dependencies: CapabilityDependencyNode[]
}

export type CapabilityRequirement = {
  capability: CapabilityId
  required: boolean
  requestedProvider?: string
  fallback?: string
  requiringPlugin: string
  requiringPluginProfile?: PluginProfile
}

export type CapabilityConflict = {
  capability: CapabilityId
  projectPlugins: Array<{
    plugin: string
    provider: string
  }>
  providers: string[]
  message: string
}

export type CapabilityStaleProvider = {
  capability: CapabilityId
  provider: string
  lastVerified?: string
  cadence?: string
  staleAt?: string
  checkedAt: string
  message: string
}

export type CapabilityBlockedProvider = {
  capability: CapabilityId
  provider: string
  trustTier: TrustTier
  installability: RegistryInstallability
  message: string
}

export type CapabilityChosenProvider = {
  capability: CapabilityId
  required: boolean
  providerRef: string
  plugin: string
  version?: string
  trustTier: TrustTier
  installability: RegistryInstallability
  providedCapability: AgentRigProvidedCapability
  verification?: AgentRigVerification
  stale: boolean
  staleReason?: string
  compatibility: CapabilityProviderCompatibility
  installConstraints: CapabilityProviderInstallConstraints
  requiredBy: string[]
  optionalFor: string[]
}

export type CapabilityResolutionIssueCode =
  | 'plugin_not_found'
  | 'dependency_not_found'
  | 'required_provider_missing'
  | 'optional_provider_missing'
  | 'capability_fallback_used'
  | 'provider_missing_capability'
  | 'provider_not_installable'
  | 'listed_required_provider'
  | 'blocked_or_yanked_provider'
  | 'stale_provider'
  | 'conflicting_required_provider'

export type CapabilityResolutionIssue = {
  severity: 'error' | 'warning'
  code: CapabilityResolutionIssueCode
  message: string
  plugin?: string
  capability?: CapabilityId
  provider?: string
}

export type CapabilityResolutionResult = {
  schemaVersion: 1
  input: {
    pluginRef: string
    resolvedAt: string
  }
  ok: boolean
  status: 'resolved' | 'failed'
  pluginTree?: CapabilityDependencyNode
  resolvedPlugins: CapabilityResolvedPlugin[]
  requiredCapabilities: CapabilityRequirement[]
  optionalCapabilities: CapabilityRequirement[]
  chosenProviders: CapabilityChosenProvider[]
  conflicts: CapabilityConflict[]
  staleProviders: CapabilityStaleProvider[]
  blockedYankedProviders: CapabilityBlockedProvider[]
  providerCompatibility: Record<string, CapabilityProviderCompatibility>
  warnings: CapabilityResolutionIssue[]
  errors: CapabilityResolutionIssue[]
}

export type CapabilityResolutionJson = CapabilityResolutionResult
