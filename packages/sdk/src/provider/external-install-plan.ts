import type { ArtifactClosure, ArtifactClosureStatus } from './extract-artifacts'
import { extractArtifactsFromRepoScan, type ExtractedArtifact } from './extract-artifacts'
import { buildProviderMaterialization, type SelectedArtifactForBundle, type SelectionProviderId } from './selection-bundle'
import { buildAgentrigUseCommand, type AgentrigUseMode, type AgentrigUseProvider } from './external-use-command'
import type { Signal, SignalKind } from '../repo-scan/types'

export type ExternalInstallSignal = Omit<
  Pick<Signal, 'kind' | 'id' | 'title' | 'description' | 'sourcePath' | 'files' | 'score'>,
  'kind'
> & {
  kind: string
}

export type ExternalInstallPlanArtifact = SelectedArtifactForBundle & {
  id: string
  artifactId: string
  title: string
  description?: string
  providerSupport: Record<SelectionProviderId, boolean>
  installable: boolean
  blockedReason?: string
}

export type BuildExternalInstallPlanInput = {
  repoFullName: string
  commitSha?: string
  ref?: string
  subdir?: string
  scanDigest: string
  signals: readonly ExternalInstallSignal[]
  artifactClosures?: readonly ArtifactClosure[]
  selectedSourcePaths?: readonly string[]
  provider?: AgentrigUseProvider
  mode?: AgentrigUseMode
}

export type ExternalInstallPlan = {
  source: {
    repoFullName: string
    commitSha?: string
    ref?: string
    subdir?: string
    scanDigest: string
  }
  provider: AgentrigUseProvider
  mode: AgentrigUseMode
  artifacts: ExternalInstallPlanArtifact[]
  selectedArtifacts: ExternalInstallPlanArtifact[]
  blockedSelectedArtifacts: ExternalInstallPlanArtifact[]
  unknownSelectedSourcePaths: string[]
  command?: string
  commandBlockedReason?: string
}

const PROVIDER_IDS: readonly SelectionProviderId[] = ['claude', 'codex', 'cursor']

export function buildExternalInstallPlan(input: BuildExternalInstallPlanInput): ExternalInstallPlan {
  const provider = input.provider ?? 'all'
  const mode = input.mode ?? { kind: 'install' }
  const artifacts = externalArtifactsFromSignals(input.signals, input.scanDigest, input.artifactClosures ?? [])
  const selectedSourcePaths = [...new Set((input.selectedSourcePaths ?? []).map((path) => path.trim()).filter(Boolean))]
  const bySourcePath = new Map(artifacts.map((artifact) => [artifact.sourcePath, artifact]))
  const selectedArtifacts = selectedSourcePaths
    .map((sourcePath) => bySourcePath.get(sourcePath))
    .filter((artifact): artifact is ExternalInstallPlanArtifact => Boolean(artifact))
  const unknownSelectedSourcePaths = selectedSourcePaths.filter((sourcePath) => !bySourcePath.has(sourcePath))
  const blockedSelectedArtifacts = selectedArtifacts.filter((artifact) => !isInstallableForProvider(artifact, provider))
  const commandBlockedReason = commandBlockedReasonFor(selectedSourcePaths, unknownSelectedSourcePaths, blockedSelectedArtifacts, provider)
  const command = commandBlockedReason
    ? undefined
    : buildAgentrigUseCommand({
      repoFullName: input.repoFullName,
      commitSha: input.commitSha,
      ref: input.ref,
      subdir: input.subdir,
      picks: selectedSourcePaths,
      provider,
      mode,
    })

  return {
    source: {
      repoFullName: input.repoFullName,
      commitSha: input.commitSha,
      ref: input.ref,
      subdir: input.subdir,
      scanDigest: input.scanDigest,
    },
    provider,
    mode,
    artifacts,
    selectedArtifacts,
    blockedSelectedArtifacts,
    unknownSelectedSourcePaths,
    ...(command ? { command } : {}),
    ...(commandBlockedReason ? { commandBlockedReason } : {}),
  }
}

function externalArtifactsFromSignals(
  signals: readonly ExternalInstallSignal[],
  scanDigest: string,
  closures: readonly ArtifactClosure[]
): ExternalInstallPlanArtifact[] {
  const signalBySourcePath = new Map(signals.map((signal) => [signal.sourcePath, signal]))
  const closureBySelector = new Map(closures.map((closure) => [closure.selector, closure]))
  return extractArtifactsFromRepoScan({
    digest: scanDigest,
    signals: signals.map((signal) => ({ ...signal, kind: signal.kind as SignalKind })) as Signal[],
  }).map((artifact) => {
    const signal = signalBySourcePath.get(artifact.sourcePath)
    const closure = closureBySelector.get(artifact.selector)
    const selected = selectedArtifactFromExtracted(artifact, closure)
    const providerSupport = providerSupportFor(selected)
    const blockedReason = blockedReasonFor(selected.closureStatus, providerSupport)
    return {
      ...selected,
      id: signal?.id ?? artifact.name,
      artifactId: artifact.artifactId,
      title: signal?.title ?? artifact.name,
      description: signal?.description,
      providerSupport,
      installable: !blockedReason,
      ...(blockedReason ? { blockedReason } : {}),
    }
  })
}

function selectedArtifactFromExtracted(
  artifact: ExtractedArtifact,
  closure?: ArtifactClosure
): SelectedArtifactForBundle {
  return {
    kind: artifact.kind,
    name: artifact.name,
    selector: artifact.selector,
    sourcePath: artifact.sourcePath,
    fileDigests: artifact.fileDigests,
    dependencies: artifact.dependencies,
    closureStatus: closure?.status ?? 'requires-full-source',
    ...(closure?.reason ? { closureReason: closure.reason } : {}),
  }
}

function providerSupportFor(artifact: SelectedArtifactForBundle): Record<SelectionProviderId, boolean> {
  return Object.fromEntries(PROVIDER_IDS.map((provider) => {
    const materialization = buildProviderMaterialization(provider, [artifact])
    return [provider, materialization.fileCopies.length > 0 || materialization.jsonWrites.length > 0]
  })) as Record<SelectionProviderId, boolean>
}

function blockedReasonFor(
  closureStatus: ArtifactClosureStatus,
  providerSupport: Record<SelectionProviderId, boolean>
) {
  if (closureStatus !== 'closed') return `Artifact is not closed: ${closureStatus}.`
  if (!PROVIDER_IDS.some((provider) => providerSupport[provider])) {
    return 'Artifact has no provider-supported materialization target.'
  }
  return undefined
}

function isInstallableForProvider(artifact: ExternalInstallPlanArtifact, provider: AgentrigUseProvider) {
  if (!artifact.installable) return false
  if (provider === 'all') return PROVIDER_IDS.some((target) => artifact.providerSupport[target])
  return artifact.providerSupport[provider]
}

function commandBlockedReasonFor(
  selectedSourcePaths: readonly string[],
  unknownSelectedSourcePaths: readonly string[],
  blockedSelectedArtifacts: readonly ExternalInstallPlanArtifact[],
  provider: AgentrigUseProvider
) {
  if (!selectedSourcePaths.length) return 'Select at least one installable artifact.'
  if (unknownSelectedSourcePaths.length) {
    return `Unknown selected source path: ${unknownSelectedSourcePaths.join(', ')}.`
  }
  if (blockedSelectedArtifacts.length) {
    const selectors = blockedSelectedArtifacts.map((artifact) => artifact.selector).join(', ')
    return `Selection includes artifacts that cannot install for ${provider}: ${selectors}.`
  }
  return undefined
}
