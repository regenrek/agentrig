import type { CapabilityId, PluginManifest, RegistryInstallability, TrustTier } from '../marketplace-listing'
import { evaluateCapabilityProviderVerification } from './validate'
import {
  CAPABILITY_RESOLUTION_TARGETS,
  type AgentRigProvidedCapability,
  type AgentRigRequiredCapability,
  type CapabilityBlockedProvider,
  type CapabilityChosenProvider,
  type CapabilityConflict,
  type CapabilityDependencyNode,
  type CapabilityPluginRecord,
  type CapabilityPluginRefParts,
  type CapabilityProviderCompatibility,
  type CapabilityProviderCompatibilityState,
  type CapabilityProviderInstallConstraints,
  type CapabilityRequirement,
  type CapabilityResolutionIssue,
  type CapabilityResolutionIssueCode,
  type CapabilityResolutionJson,
  type CapabilityResolutionResult,
  type CapabilityResolveInput,
  type CapabilityResolvedPlugin,
  type CapabilityStaleProvider,
  type CapabilityTarget,
} from './types'

type IssueInput = Omit<CapabilityResolutionIssue, 'severity'> & {
  severity?: CapabilityResolutionIssue['severity']
}

type RequirementGroup = {
  capability: CapabilityId
  requirements: CapabilityRequirement[]
  required: boolean
}

const TRUST_RANK: Record<TrustTier, number> = {
  official: 0,
  reviewed: 1,
  listed: 2,
  blocked: 3,
  yanked: 4,
}

const INSTALLABILITY_RANK: Record<RegistryInstallability, number> = {
  installable: 0,
  discovery_only: 1,
  blocked: 2,
  yanked: 3,
}

const COMPATIBILITY_STATES = new Set<CapabilityProviderCompatibilityState>([
  'native',
  'port',
  'unsupported',
  'unknown',
])

export async function resolveCapabilityGraph(input: CapabilityResolveInput): Promise<CapabilityResolutionResult> {
  const resolvedAt = normalizeNow(input.now)
  const errors: CapabilityResolutionIssue[] = []
  const warnings: CapabilityResolutionIssue[] = []
  const recordsByName = new Map<string, CapabilityPluginRecord>()
  const loadedDependenciesFor = new Set<string>()
  const visiting = new Set<string>()

  const addIssue = (issue: IssueInput) => {
    const normalized: CapabilityResolutionIssue = {
      severity: issue.severity ?? 'error',
      code: issue.code,
      message: issue.message,
      plugin: issue.plugin,
      capability: issue.capability,
      provider: issue.provider,
    }
    if (normalized.severity === 'warning') warnings.push(normalized)
    else errors.push(normalized)
  }

  const registerRecord = (record: CapabilityPluginRecord) => {
    recordsByName.set(record.manifest.name, record)
  }

  const findRecord = (ref: string) => {
    const parts = parseCapabilityPluginRef(ref)
    return recordsByName.get(parts.name)
  }

  const loadDependencyNode = async (
    ref: string,
    missingIssue: IssueInput,
    dependencyRef?: string
  ): Promise<CapabilityDependencyNode | undefined> => {
    const parts = parseCapabilityPluginRef(ref)
    let record = recordsByName.get(parts.name)

    if (!record) {
      const loaded = await input.loader.loadPlugin(ref)
      if (!loaded) {
        addIssue(missingIssue)
        return undefined
      }
      record = loaded
      registerRecord(record)
    }

    const nodeBase = resolvedPluginSummary(record)
    if (visiting.has(record.manifest.name)) {
      return {
        ...nodeBase,
        dependencyRef,
        alreadyResolved: true,
        dependencies: [],
      }
    }

    if (loadedDependenciesFor.has(record.manifest.name)) {
      return {
        ...nodeBase,
        dependencyRef,
        alreadyResolved: true,
        dependencies: [],
      }
    }

    visiting.add(record.manifest.name)
    const dependencies: CapabilityDependencyNode[] = []
    for (const depRef of pluginDependencies(record.manifest)) {
      const child = await loadDependencyNode(
        depRef,
        {
          code: 'dependency_not_found',
          message: `Plugin dependency "${depRef}" required by "${record.manifest.name}" could not be loaded.`,
          plugin: record.manifest.name,
        },
        depRef
      )
      if (child) dependencies.push(child)
    }
    visiting.delete(record.manifest.name)
    loadedDependenciesFor.add(record.manifest.name)

    return {
      ...nodeBase,
      dependencyRef,
      dependencies: sortDependencyNodes(dependencies),
    }
  }

  const pluginTree = await loadDependencyNode(
    input.pluginRef,
    {
      code: 'plugin_not_found',
      message: `Requested plugin "${input.pluginRef}" could not be loaded.`,
      plugin: parseCapabilityPluginRef(input.pluginRef).name,
    }
  )

  const requirements = collectRequirements([...recordsByName.values()])
  const conflicts = collectProjectProviderConflicts(requirements)
  for (const conflict of conflicts) {
    addIssue({
      code: 'conflicting_required_provider',
      capability: conflict.capability,
      message: conflict.message,
    })
  }

  const chosenProviders: CapabilityChosenProvider[] = []
  const staleProviders: CapabilityStaleProvider[] = []
  const blockedYankedProviders: CapabilityBlockedProvider[] = []
  const providerCompatibility: Record<string, CapabilityProviderCompatibility> = {}

  for (const group of groupRequirements(requirements)) {
    const requestedProviders = uniqueSorted(
      group.requirements
        .map((requirement) => requirement.requestedProvider)
        .filter((provider): provider is string => Boolean(provider))
    )

    if (requestedProviders.length > 1) continue

    const provider = await resolveProviderForCapability(group.capability, requestedProviders[0], group.required)
    if (!provider) {
      if (!requestedProviders[0]) {
        addIssue({
          severity: group.required ? 'error' : 'warning',
          code: group.required ? 'required_provider_missing' : 'optional_provider_missing',
          capability: group.capability,
          message: group.required
            ? `Required capability "${group.capability}" has no installable provider.`
            : `Optional capability "${group.capability}" has no provider.`,
        })
      }
      continue
    }

    const providedCapability = provider.manifest['x-agentrig']?.providesCapabilities?.[group.capability]
    if (!providedCapability) {
      addIssue({
        severity: group.required ? 'error' : 'warning',
        code: 'provider_missing_capability',
        capability: group.capability,
        provider: provider.manifest.name,
        message: `Provider "${provider.manifest.name}" does not provide capability "${group.capability}".`,
      })
      continue
    }

    const compatibility = compatibilityForProvider(provider)
    const installConstraints = installConstraintsForProvider(provider)
    providerCompatibility[provider.manifest.name] = compatibility

    validateProviderTrust({
      capability: group.capability,
      provider,
      required: group.required,
      addIssue,
      blockedYankedProviders,
    })

    const verification = evaluateCapabilityProviderVerification(provider.manifest, resolvedAt)
    if (verification.stale) {
      const staleProvider: CapabilityStaleProvider = {
        capability: group.capability,
        provider: provider.manifest.name,
        lastVerified: verification.lastVerified,
        cadence: verification.cadence,
        staleAt: verification.staleAt,
        checkedAt: resolvedAt.toISOString(),
        message: verification.reason,
      }
      staleProviders.push(staleProvider)
      addIssue({
        severity: group.required ? 'error' : 'warning',
        code: 'stale_provider',
        capability: group.capability,
        provider: provider.manifest.name,
        message: verification.reason,
      })
    }

    chosenProviders.push({
      capability: group.capability,
      required: group.required,
      providerRef: provider.ref,
      plugin: provider.manifest.name,
      version: provider.version ?? provider.manifest.version,
      trustTier: provider.trustTier,
      installability: provider.installability,
      providedCapability: providedCapability as AgentRigProvidedCapability,
      verification: provider.manifest['x-agentrig']?.verification,
      stale: verification.stale,
      staleReason: verification.stale ? verification.reason : undefined,
      compatibility,
      installConstraints,
      requiredBy: uniqueSorted(
        group.requirements
          .filter((requirement) => requirement.required)
          .map((requirement) => requirement.requiringPlugin)
      ),
      optionalFor: uniqueSorted(
        group.requirements
          .filter((requirement) => !requirement.required)
          .map((requirement) => requirement.requiringPlugin)
      ),
    })
  }

  const result: CapabilityResolutionResult = {
    schemaVersion: 1,
    input: {
      pluginRef: input.pluginRef,
      resolvedAt: resolvedAt.toISOString(),
    },
    ok: errors.length === 0,
    status: errors.length === 0 ? 'resolved' : 'failed',
    pluginTree,
    resolvedPlugins: [...recordsByName.values()].map(resolvedPluginSummary).sort(compareResolvedPlugins),
    requiredCapabilities: requirements.filter((requirement) => requirement.required).sort(compareRequirements),
    optionalCapabilities: requirements.filter((requirement) => !requirement.required).sort(compareRequirements),
    chosenProviders: chosenProviders.sort(compareChosenProviders),
    conflicts: conflicts.sort((left, right) => left.capability.localeCompare(right.capability)),
    staleProviders: staleProviders.sort(compareStaleProviders),
    blockedYankedProviders: blockedYankedProviders.sort(compareBlockedProviders),
    providerCompatibility: sortRecord(providerCompatibility),
    warnings: warnings.sort(compareIssues),
    errors: errors.sort(compareIssues),
  }

  return result

  async function resolveProviderForCapability(
    capability: CapabilityId,
    requestedProvider: string | undefined,
    required: boolean
  ): Promise<CapabilityPluginRecord | undefined> {
    if (requestedProvider) {
      const existing = findRecord(requestedProvider)
      if (existing) return existing

      const node = await loadDependencyNode(
        requestedProvider,
        {
          severity: required ? 'error' : 'warning',
          code: required ? 'required_provider_missing' : 'optional_provider_missing',
          capability,
          provider: parseCapabilityPluginRef(requestedProvider).name,
          message: required
            ? `Required provider "${requestedProvider}" for capability "${capability}" could not be loaded.`
            : `Optional provider "${requestedProvider}" for capability "${capability}" could not be loaded.`,
        }
      )
      if (!node) return undefined
      return findRecord(requestedProvider)
    }

    const loadedProvider = bestProviderForCapability([...recordsByName.values()], capability)
    if (loadedProvider) return loadedProvider

    if (!input.loader.findCapabilityProviders) return undefined

    const discovered = await input.loader.findCapabilityProviders(capability)
    for (const provider of discovered) {
      registerRecord(provider)
      await loadDependencyNode(provider.ref, {
        severity: required ? 'error' : 'warning',
        code: required ? 'required_provider_missing' : 'optional_provider_missing',
        capability,
        provider: provider.manifest.name,
        message: `Discovered provider "${provider.manifest.name}" for capability "${capability}" could not be loaded.`,
      })
    }

    return bestProviderForCapability([...recordsByName.values()], capability)
  }
}

export function capabilityResolutionToJson(result: CapabilityResolutionResult): CapabilityResolutionJson {
  return result
}

export function parseCapabilityPluginRef(ref: string): CapabilityPluginRefParts {
  const raw = ref.trim()
  const slashIndex = raw.lastIndexOf('/')
  const registryAlias = slashIndex >= 0 ? raw.slice(0, slashIndex) : undefined
  const nameAndVersion = slashIndex >= 0 ? raw.slice(slashIndex + 1) : raw
  const atIndex = nameAndVersion.lastIndexOf('@')
  const hasVersion = atIndex > 0
  const name = hasVersion ? nameAndVersion.slice(0, atIndex) : nameAndVersion
  const requestedVersion = hasVersion ? nameAndVersion.slice(atIndex + 1) : undefined

  return {
    raw,
    name,
    registryAlias,
    requestedVersion,
  }
}

function validateProviderTrust(args: {
  capability: CapabilityId
  provider: CapabilityPluginRecord
  required: boolean
  addIssue: (issue: IssueInput) => void
  blockedYankedProviders: CapabilityBlockedProvider[]
}) {
  const { capability, provider, required, addIssue, blockedYankedProviders } = args
  const blockedOrYanked = provider.trustTier === 'blocked'
    || provider.trustTier === 'yanked'
    || provider.installability === 'blocked'
    || provider.installability === 'yanked'

  if (blockedOrYanked) {
    const blocked: CapabilityBlockedProvider = {
      capability,
      provider: provider.manifest.name,
      trustTier: provider.trustTier,
      installability: provider.installability,
      message: `Provider "${provider.manifest.name}" is ${provider.trustTier}/${provider.installability}.`,
    }
    blockedYankedProviders.push(blocked)
    addIssue({
      code: 'blocked_or_yanked_provider',
      capability,
      provider: provider.manifest.name,
      message: blocked.message,
    })
  }

  if (required && provider.trustTier === 'listed') {
    addIssue({
      code: 'listed_required_provider',
      capability,
      provider: provider.manifest.name,
      message: `Listed provider "${provider.manifest.name}" may not satisfy required capability "${capability}".`,
    })
  }

  if (required && provider.installability !== 'installable') {
    addIssue({
      code: 'provider_not_installable',
      capability,
      provider: provider.manifest.name,
      message: `Required provider "${provider.manifest.name}" for capability "${capability}" is not installable.`,
    })
  }
}

function collectRequirements(records: readonly CapabilityPluginRecord[]): CapabilityRequirement[] {
  const requirements: CapabilityRequirement[] = []
  for (const record of [...records].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))) {
    const extension = record.manifest['x-agentrig']
    const requiredCapabilities = extension?.requiresCapabilities ?? {}
    for (const [capability, requirement] of Object.entries(requiredCapabilities) as Array<[CapabilityId, AgentRigRequiredCapability]>) {
      requirements.push({
        capability,
        required: requirement.required,
        requestedProvider: requirement.provider,
        requiringPlugin: record.manifest.name,
        requiringPluginProfile: extension?.profile,
      })
    }
  }
  return requirements
}

function groupRequirements(requirements: readonly CapabilityRequirement[]): RequirementGroup[] {
  const groups = new Map<CapabilityId, CapabilityRequirement[]>()
  for (const requirement of requirements) {
    const existing = groups.get(requirement.capability) ?? []
    existing.push(requirement)
    groups.set(requirement.capability, existing)
  }
  return [...groups.entries()]
    .map(([capability, capabilityRequirements]) => ({
      capability,
      requirements: capabilityRequirements.sort(compareRequirements),
      required: capabilityRequirements.some((requirement) => requirement.required),
    }))
    .sort((left, right) => left.capability.localeCompare(right.capability))
}

function collectProjectProviderConflicts(requirements: readonly CapabilityRequirement[]): CapabilityConflict[] {
  const byCapability = new Map<CapabilityId, Map<string, string[]>>()
  for (const requirement of requirements) {
    if (!requirement.required || requirement.requiringPluginProfile !== 'project' || !requirement.requestedProvider) {
      continue
    }
    const providers = byCapability.get(requirement.capability) ?? new Map<string, string[]>()
    const plugins = providers.get(requirement.requestedProvider) ?? []
    plugins.push(requirement.requiringPlugin)
    providers.set(requirement.requestedProvider, plugins)
    byCapability.set(requirement.capability, providers)
  }

  const conflicts: CapabilityConflict[] = []
  for (const [capability, providers] of byCapability) {
    if (providers.size <= 1) continue
    const projectPlugins = [...providers.entries()].flatMap(([provider, plugins]) =>
      plugins.map((plugin) => ({ plugin, provider }))
    ).sort((left, right) => left.plugin.localeCompare(right.plugin))
    const providerNames = [...providers.keys()].sort()
    conflicts.push({
      capability,
      projectPlugins,
      providers: providerNames,
      message: `Project plugins require capability "${capability}" with different providers: ${providerNames.join(', ')}.`,
    })
  }
  return conflicts
}

function bestProviderForCapability(records: readonly CapabilityPluginRecord[], capability: CapabilityId) {
  return records
    .filter((record) => Boolean(record.manifest['x-agentrig']?.providesCapabilities?.[capability]))
    .sort(compareProviderCandidates)[0]
}

function compareProviderCandidates(left: CapabilityPluginRecord, right: CapabilityPluginRecord) {
  return TRUST_RANK[left.trustTier] - TRUST_RANK[right.trustTier]
    || INSTALLABILITY_RANK[left.installability] - INSTALLABILITY_RANK[right.installability]
    || left.manifest.name.localeCompare(right.manifest.name)
}

function pluginDependencies(manifest: Pick<PluginManifest, 'x-agentrig'>) {
  return [...(manifest['x-agentrig']?.pluginDependencies ?? [])].sort()
}

function resolvedPluginSummary(record: CapabilityPluginRecord): CapabilityResolvedPlugin {
  return {
    ref: record.ref,
    plugin: record.manifest.name,
    version: record.version ?? record.manifest.version,
    profile: record.manifest['x-agentrig']?.profile,
    trustTier: record.trustTier,
    installability: record.installability,
    registryAlias: record.registryAlias,
    registryRef: record.registryRef,
    snapshotDigest: record.snapshotDigest,
  }
}

function compatibilityForProvider(record: CapabilityPluginRecord): CapabilityProviderCompatibility {
  const extensionCompatibility = compatibilityFromExtension(record.manifest)
  const raw = {
    ...extensionCompatibility,
    ...record.providerCompatibility,
  }

  return Object.fromEntries(
    CAPABILITY_RESOLUTION_TARGETS.map((target) => {
      const state = raw[target]
      return [target, state && COMPATIBILITY_STATES.has(state) ? state : 'unknown']
    })
  ) as CapabilityProviderCompatibility
}

function compatibilityFromExtension(manifest: Pick<PluginManifest, 'x-agentrig'>) {
  const extension = manifest['x-agentrig'] as Record<string, unknown> | undefined
  const compatibility: Partial<Record<CapabilityTarget, CapabilityProviderCompatibilityState>> = {}
  const targetProviders = extension?.targetProviders

  if (Array.isArray(targetProviders)) {
    for (const target of CAPABILITY_RESOLUTION_TARGETS) {
      compatibility[target] = targetProviders.includes(target) ? 'native' : 'unsupported'
    }
  }

  const rawCompatibility = extension?.providerCompatibility
  if (isRecord(rawCompatibility)) {
    for (const target of CAPABILITY_RESOLUTION_TARGETS) {
      const value = rawCompatibility[target]
      if (typeof value === 'string' && COMPATIBILITY_STATES.has(value as CapabilityProviderCompatibilityState)) {
        compatibility[target] = value as CapabilityProviderCompatibilityState
      }
    }
  }

  return compatibility
}

function installConstraintsForProvider(record: CapabilityPluginRecord): CapabilityProviderInstallConstraints {
  return normalizeInstallConstraints(record.installConstraints)
    ?? normalizeInstallConstraints((record.manifest['x-agentrig'] as Record<string, unknown> | undefined)?.installConstraints)
    ?? normalizeInstallConstraints((record.manifest['x-agentrig'] as Record<string, unknown> | undefined)?.providerInstallConstraints)
    ?? {}
}

function normalizeInstallConstraints(input: unknown): CapabilityProviderInstallConstraints | undefined {
  if (!isRecord(input)) return undefined

  const constraints: CapabilityProviderInstallConstraints = {}
  for (const key of ['common', ...CAPABILITY_RESOLUTION_TARGETS] as const) {
    const value = input[key]
    if (Array.isArray(value)) {
      const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      if (strings.length) constraints[key] = strings
    } else if (typeof value === 'string' && value.trim()) {
      constraints[key] = [value]
    }
  }

  return Object.keys(constraints).length ? constraints : undefined
}

function normalizeNow(now: CapabilityResolveInput['now']) {
  if (now === undefined) return new Date()
  const date = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid capability resolver timestamp: ${String(now)}`)
  return date
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort()
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}

function sortDependencyNodes(nodes: readonly CapabilityDependencyNode[]) {
  return [...nodes].sort((left, right) => left.plugin.localeCompare(right.plugin))
}

function compareResolvedPlugins(left: CapabilityResolvedPlugin, right: CapabilityResolvedPlugin) {
  return left.plugin.localeCompare(right.plugin)
}

function compareRequirements(left: CapabilityRequirement, right: CapabilityRequirement) {
  return left.capability.localeCompare(right.capability)
    || left.requiringPlugin.localeCompare(right.requiringPlugin)
    || String(left.requestedProvider ?? '').localeCompare(String(right.requestedProvider ?? ''))
}

function compareChosenProviders(left: CapabilityChosenProvider, right: CapabilityChosenProvider) {
  return left.capability.localeCompare(right.capability)
    || left.plugin.localeCompare(right.plugin)
}

function compareStaleProviders(left: CapabilityStaleProvider, right: CapabilityStaleProvider) {
  return left.capability.localeCompare(right.capability)
    || left.provider.localeCompare(right.provider)
}

function compareBlockedProviders(left: CapabilityBlockedProvider, right: CapabilityBlockedProvider) {
  return left.capability.localeCompare(right.capability)
    || left.provider.localeCompare(right.provider)
}

function compareIssues(left: CapabilityResolutionIssue, right: CapabilityResolutionIssue) {
  return left.code.localeCompare(right.code)
    || String(left.capability ?? '').localeCompare(String(right.capability ?? ''))
    || String(left.provider ?? '').localeCompare(String(right.provider ?? ''))
    || left.message.localeCompare(right.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
