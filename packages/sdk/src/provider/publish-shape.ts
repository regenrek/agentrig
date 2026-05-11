import type { RepoScanPluginCandidate, RepoScanReport } from '../repo-scan/types'
import type { ArtifactClosure, ArtifactClosureStatus, ArtifactFileDigest, ExtractedArtifact } from './extract-artifacts'
import { extractArtifactsFromRepoScan } from './extract-artifacts'
import { parseArtifactSelector, type ArtifactKind } from './artifact-kinds'
import { destinationPathForSignalFile } from './materialize'

export const PUBLISH_SHAPE_KINDS = [
  'plugin_all',
  'generated_plugin',
  'standalone_artifacts',
  'discovery_only',
] as const

export type PublishShapeKind = (typeof PUBLISH_SHAPE_KINDS)[number]

export type PublishShapeDefinition = {
  id: PublishShapeKind
  label: string
  description: string
  helpUrl?: string
  example?: string
}

export const PUBLISH_SHAPE_DEFINITIONS = {
  plugin_all: {
    id: 'plugin_all',
    label: 'Submit full plugin',
    description: "Publish this repo's existing detected `.plugin/plugin.json` plugin as-is.",
  },
  generated_plugin: {
    id: 'generated_plugin',
    label: 'Generate AgentRig plugin',
    description: 'Compose selected portable artifacts (skills, MCPs, hooks) from this repo into a new plugin package.',
  },
  standalone_artifacts: {
    id: 'standalone_artifacts',
    label: 'Submit one skill standalone',
    description: 'Publish the selected skill as its own registry artifact (semver tag required).',
  },
  discovery_only: {
    id: 'discovery_only',
    label: 'Submit as discovery only',
    description: 'Log scan metadata for review without creating an installable registry entry.',
  },
} satisfies Record<PublishShapeKind, PublishShapeDefinition>

export type PublishInstallability = 'installable' | 'discovery_only' | 'blocked'

export type SubmitSource = {
  repoUrl: string
  owner: string
  repo: string
  ref: string
  commitSha: string
  subdir?: string
}

export type PublishPluginCandidate = RepoScanPluginCandidate

export type PublishArtifact = Pick<
  ExtractedArtifact,
  | 'kind'
  | 'name'
  | 'selector'
  | 'sourcePath'
  | 'fileDigests'
  | 'dependencies'
  | 'capabilitySet'
  | 'declaredNetworkDomains'
  | 'declaredSecrets'
  | 'runtimeRequirements'
> & {
  artifactId: string
  files: ArtifactFileDigest[]
  closureStatus: ArtifactClosureStatus
  requiredSelectors: string[]
  requiredPaths: string[]
  closureReason?: string
}

export type PublishScanSkipped = {
  path: string
  reason: string
}

export type PublishScanResult = {
  scannerVersion: string
  scanDigest: string
  treeSha?: string
  source: SubmitSource
  pluginCandidate?: PublishPluginCandidate
  artifacts: PublishArtifact[]
  warnings: string[]
  skipped: PublishScanSkipped[]
}

export type PublishShapeOutput = {
  kind: ArtifactKind
  selector?: string
  artifactId?: string
  installability: PublishInstallability
}

export type GeneratedPluginSkippedArtifact = {
  selector: string
  status: ArtifactClosureStatus
  reason: string
  requiredSelectors: string[]
  requiredPaths: string[]
}

export type GeneratedPluginSetupNote = {
  selector?: string
  message: string
}

export type GeneratedPluginTransformPlan = {
  requestedSelectors: string[]
  includedSelectors: string[]
  skipped: GeneratedPluginSkippedArtifact[]
  setupNotes: GeneratedPluginSetupNote[]
}

export type PublishShapeCandidate = {
  shape: PublishShapeKind
  label: string
  defaultSelected: boolean
  allowed: boolean
  blockedReason?: string
  includedSelectors: string[]
  transformPlan?: GeneratedPluginTransformPlan
  produces: PublishShapeOutput[]
}

export type SubmitEnrichmentDraft = {
  displayName?: string
  description?: string
  keywords?: string[]
  summary?: string
  categories?: string[]
}

export type SubmitReviewMetadata = {
  provenanceVerified: boolean
  ownershipVerified: boolean
  turnstileVerified?: boolean
  requesterUserId?: string
  requesterEmail?: string
}

export type SubmitPublishPayload = {
  schemaVersion: 1
  source: SubmitSource
  scan: PublishScanResult
  publishShape: {
    shape: PublishShapeKind
    includedSelectors: string[]
  }
  transformPlan?: GeneratedPluginTransformPlan
  enrichment?: SubmitEnrichmentDraft
  review: SubmitReviewMetadata
}

export type BuildPublishScanResultInput = {
  source: SubmitSource
  report: Pick<RepoScanReport, 'signals' | 'digest'> & Partial<Pick<RepoScanReport, 'pluginCandidates'>>
  scannerVersion: string
  treeSha?: string
  pluginCandidate?: PublishPluginCandidate
  closures?: readonly ArtifactClosure[]
  warnings?: readonly string[]
  skipped?: readonly PublishScanSkipped[]
}

export type BuildSubmitPublishPayloadInput = {
  source: SubmitSource
  scan: PublishScanResult
  selectedSelectors?: readonly string[]
  requestedShape?: PublishShapeKind
  enrichment?: SubmitEnrichmentDraft
  review: SubmitReviewMetadata
}

export function buildPublishScanResult(input: BuildPublishScanResultInput): PublishScanResult {
  assertSubmitSource(input.source)
  if (!input.report.digest.trim()) throw new Error('Publish scan result requires scan digest.')
  if (!input.scannerVersion.trim()) throw new Error('Publish scan result requires scanner version.')

  const closures = new Map((input.closures ?? []).map((closure) => [closure.selector, closure]))
  const artifacts = extractArtifactsFromRepoScan(input.report)
    .map((artifact) => publishArtifactFromExtracted(artifact, closures.get(artifact.selector)))
    .sort((left, right) => left.selector.localeCompare(right.selector))
  const pluginCandidate = input.pluginCandidate ?? pluginCandidateFromReport(input.report)

  return {
    scannerVersion: input.scannerVersion,
    scanDigest: input.report.digest,
    ...(input.treeSha ? { treeSha: input.treeSha } : {}),
    source: input.source,
    ...(pluginCandidate ? { pluginCandidate: normalizePluginCandidate(pluginCandidate) } : {}),
    artifacts,
    warnings: [...new Set(input.warnings ?? [])].sort(),
    skipped: [...(input.skipped ?? [])].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export function buildPublishShapeCandidates(
  scan: PublishScanResult,
  selectedSelectors: readonly string[] = defaultSelectedSelectors(scan)
): PublishShapeCandidate[] {
  const selected = normalizePublishSelectors(selectedSelectors, scan.artifacts)
  const candidates = PUBLISH_SHAPE_KINDS.map((shape) => candidateForShape(scan, shape, selected))
  const defaultShape = candidates.find((candidate) => candidate.allowed)?.shape ?? 'discovery_only'
  return candidates.map((candidate) => ({ ...candidate, defaultSelected: candidate.shape === defaultShape }))
}

export function buildSubmitPublishPayload(input: BuildSubmitPublishPayloadInput): SubmitPublishPayload {
  assertSubmitSource(input.source)
  assertSourceMatchesScan(input.source, input.scan.source)

  const selectedSelectors = normalizePublishSelectors(input.selectedSelectors ?? defaultSelectedSelectors(input.scan), input.scan.artifacts)
  const candidates = buildPublishShapeCandidates(input.scan, selectedSelectors)
  const shape = input.requestedShape ?? candidates.find((candidate) => candidate.defaultSelected)?.shape ?? 'discovery_only'
  if (!isPublishShapeKind(shape)) throw new Error(`Unsupported publish shape: ${shape}`)

  const candidate = candidates.find((item) => item.shape === shape)
  if (!candidate?.allowed) {
    throw new Error(candidate?.blockedReason ?? `Publish shape is not allowed: ${shape}`)
  }

  return {
    schemaVersion: 1,
    source: input.source,
    scan: input.scan,
    publishShape: {
      shape,
      includedSelectors: candidate.includedSelectors,
    },
    ...(candidate.transformPlan ? { transformPlan: candidate.transformPlan } : {}),
    ...(input.enrichment ? { enrichment: normalizeEnrichment(input.enrichment) } : {}),
    review: input.review,
  }
}

export function isPublishShapeKind(value: string): value is PublishShapeKind {
  return (PUBLISH_SHAPE_KINDS as readonly string[]).includes(value)
}

export function normalizePublishSelectors(
  selectors: readonly string[],
  artifacts: readonly Pick<PublishArtifact, 'selector'>[]
): string[] {
  const available = new Set(artifacts.map((artifact) => artifact.selector))
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const selector of selectors) {
    const parsed = parseArtifactSelector(selector).selector
    if (seen.has(parsed)) throw new Error(`Duplicate publish selector: ${parsed}`)
    if (!available.has(parsed)) throw new Error(`Unknown publish selector: ${parsed}`)
    seen.add(parsed)
    normalized.push(parsed)
  }

  return normalized.sort()
}

function candidateForShape(
  scan: PublishScanResult,
  shape: PublishShapeKind,
  selectedSelectors: readonly string[]
): PublishShapeCandidate {
  const requestedSelectors = shape === 'plugin_all' ? defaultSelectedSelectors(scan) : [...selectedSelectors]
  const requestedArtifacts = artifactsBySelector(scan, requestedSelectors)
  const transformPlan = shape === 'generated_plugin' ? generatedPluginTransformPlan(requestedArtifacts) : undefined
  const includedSelectors = transformPlan?.includedSelectors ?? requestedSelectors
  const includedArtifacts = artifactsBySelector(scan, includedSelectors)
  const blockedReason = blockedReasonForShape(scan, shape, requestedArtifacts, transformPlan)
  return {
    shape,
    label: PUBLISH_SHAPE_DEFINITIONS[shape].label,
    defaultSelected: false,
    allowed: !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
    includedSelectors,
    ...(transformPlan ? { transformPlan } : {}),
    produces: outputsForShape(scan, shape, includedArtifacts, !blockedReason),
  }
}

function blockedReasonForShape(
  scan: PublishScanResult,
  shape: PublishShapeKind,
  selectedArtifacts: readonly PublishArtifact[],
  transformPlan?: GeneratedPluginTransformPlan
) {
  if (shape === 'discovery_only') return undefined
  if (shape === 'plugin_all') {
    return scan.pluginCandidate ? undefined : 'plugin_all requires a detected plugin candidate.'
  }
  if (selectedArtifacts.length === 0) return `${shape} requires at least one selected artifact.`
  if (shape === 'generated_plugin') {
    if (scan.pluginCandidate) return 'generated_plugin is only available when no .plugin/plugin.json candidate exists.'
    return transformPlan?.includedSelectors.length ? undefined : 'generated_plugin requires at least one transformable selected artifact.'
  }
  const notClosed = selectedArtifacts.filter((artifact) => artifact.closureStatus !== 'closed')
  if (notClosed.length) {
    return `${shape} requires closed artifacts: ${notClosed.map((artifact) => artifact.selector).join(', ')}.`
  }
  return undefined
}

function outputsForShape(
  scan: PublishScanResult,
  shape: PublishShapeKind,
  selectedArtifacts: readonly PublishArtifact[],
  allowed: boolean
): PublishShapeOutput[] {
  if (shape === 'plugin_all') {
    return scan.pluginCandidate
      ? [{ kind: 'plugin', artifactId: scan.pluginCandidate.artifactId, installability: allowed ? 'installable' : 'blocked' }]
      : []
  }
  if (shape === 'generated_plugin') {
    return [{
      kind: 'plugin',
      artifactId: fallbackPluginArtifactId(scan.source),
      installability: allowed ? 'installable' : 'blocked',
    }]
  }
  if (shape === 'standalone_artifacts') {
    return selectedArtifacts.map((artifact) => ({
      kind: artifact.kind,
      selector: artifact.selector,
      artifactId: artifact.artifactId,
      installability: allowed ? 'installable' : 'blocked',
    }))
  }
  return selectedArtifacts.map((artifact) => ({
    kind: artifact.kind,
    selector: artifact.selector,
    artifactId: artifact.artifactId,
    installability: 'discovery_only',
  }))
}

function generatedPluginTransformPlan(selectedArtifacts: readonly PublishArtifact[]): GeneratedPluginTransformPlan {
  const included: PublishArtifact[] = []
  const skipped: GeneratedPluginSkippedArtifact[] = []
  const destinations = new Map<string, { selector: string; digest: string }>()

  for (const artifact of selectedArtifacts) {
    if (artifact.closureStatus !== 'closed') {
      skipped.push({
        selector: artifact.selector,
        status: artifact.closureStatus,
        reason: artifact.closureReason ?? `Artifact is not portable: ${artifact.closureStatus}.`,
        requiredSelectors: [...artifact.requiredSelectors].sort(),
        requiredPaths: [...artifact.requiredPaths].sort(),
      })
      continue
    }

    const conflict = materializedDestinationConflict(artifact, destinations)
    if (conflict) {
      skipped.push({
        selector: artifact.selector,
        status: artifact.closureStatus,
        reason: conflict,
        requiredSelectors: [],
        requiredPaths: [],
      })
      continue
    }
    included.push(artifact)
  }

  return {
    requestedSelectors: selectedArtifacts.map((artifact) => artifact.selector).sort(),
    includedSelectors: included.map((artifact) => artifact.selector).sort(),
    skipped: skipped.sort((left, right) => left.selector.localeCompare(right.selector)),
    setupNotes: [],
  }
}

function materializedDestinationConflict(artifact: PublishArtifact, destinations: Map<string, { selector: string; digest: string }>) {
  const ownedDestinations = new Map<string, string>()
  for (const file of artifact.files) {
    let destination: string
    try {
      destination = destinationPathForSignalFile(artifact.kind as any, artifact.name, artifact.sourcePath, file.path)
    } catch (error) {
      return error instanceof Error ? error.message : 'Artifact cannot be materialized into a generated plugin.'
    }
    const digest = normalizeFileDigest(file.digest)
    const localDigest = ownedDestinations.get(destination)
    if (localDigest && localDigest !== digest) {
      return `Materialized path conflict inside ${artifact.selector}: ${destination}.`
    }
    const owner = destinations.get(destination)
    if (owner && owner.digest !== digest) {
      return `Materialized path conflict with ${owner.selector}: ${destination}.`
    }
    ownedDestinations.set(destination, digest)
  }
  for (const [destination, digest] of ownedDestinations) destinations.set(destination, { selector: artifact.selector, digest })
  return null
}

function normalizeFileDigest(digest: string) {
  return digest.trim().replace(/^sha256:/, '')
}

function publishArtifactFromExtracted(artifact: ExtractedArtifact, closure?: ArtifactClosure): PublishArtifact {
  return {
    kind: artifact.kind,
    name: artifact.name,
    artifactId: artifact.artifactId,
    selector: artifact.selector,
    sourcePath: artifact.sourcePath,
    files: artifact.fileDigests,
    fileDigests: artifact.fileDigests,
    dependencies: artifact.dependencies,
    capabilitySet: artifact.capabilitySet,
    declaredNetworkDomains: artifact.declaredNetworkDomains,
    declaredSecrets: artifact.declaredSecrets,
    runtimeRequirements: artifact.runtimeRequirements,
    closureStatus: closure?.status ?? 'requires-full-source',
    requiredSelectors: closure?.requiredSelectors ?? [],
    requiredPaths: closure?.requiredPaths ?? [],
    closureReason: closure?.reason ?? 'Artifact closure has not been evaluated.',
  }
}

function normalizePluginCandidate(candidate: PublishPluginCandidate): PublishPluginCandidate {
  if (!candidate.artifactId.trim()) throw new Error('Plugin candidate requires artifactId.')
  if (!candidate.sourcePath.trim()) throw new Error('Plugin candidate requires sourcePath.')
  if (!candidate.manifestPath.trim()) throw new Error('Plugin candidate requires manifestPath.')
  if (candidate.files.length === 0) throw new Error('Plugin candidate requires files.')
  return {
    ...candidate,
    files: [...candidate.files].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

function pluginCandidateFromReport(report: Pick<RepoScanReport, 'signals' | 'digest'> & Partial<Pick<RepoScanReport, 'pluginCandidates'>>) {
  const candidates = report.pluginCandidates ?? []
  return candidates.length === 1 ? candidates[0] : undefined
}

function artifactsBySelector(
  scan: PublishScanResult,
  selectors: readonly string[]
): PublishArtifact[] {
  const bySelector = new Map(scan.artifacts.map((artifact) => [artifact.selector, artifact]))
  return selectors.map((selector) => {
    const artifact = bySelector.get(selector)
    if (!artifact) throw new Error(`Unknown publish selector: ${selector}`)
    return artifact
  })
}

function defaultSelectedSelectors(scan: PublishScanResult) {
  return artifactsInPluginRoot(scan).map((artifact) => artifact.selector)
}

function artifactsInPluginRoot(scan: PublishScanResult) {
  const sourcePath = scan.pluginCandidate?.sourcePath
  if (sourcePath === undefined) return scan.artifacts
  const root = normalizePluginRoot(sourcePath)
  if (!root) return scan.artifacts
  const prefix = `${root}/`
  return scan.artifacts.filter((artifact) =>
    artifact.sourcePath === root || artifact.sourcePath.startsWith(prefix)
  )
}

function normalizePluginRoot(sourcePath: string) {
  const trimmed = sourcePath.trim().replace(/\/+$/g, '')
  return trimmed === '.' ? '' : trimmed
}

function fallbackPluginArtifactId(source: SubmitSource) {
  const owner = safeArtifactIdSegment(source.owner)
  const repo = safeArtifactIdSegment(source.repo)
  if (!owner || !repo) throw new Error('Generated plugin publishing requires source owner and repo.')
  return `${owner}.${repo}`
}

function safeArtifactIdSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
}

function assertSubmitSource(source: SubmitSource) {
  if (!source.repoUrl.trim()) throw new Error('Submit source requires repoUrl.')
  if (!source.owner.trim()) throw new Error('Submit source requires owner.')
  if (!source.repo.trim()) throw new Error('Submit source requires repo.')
  if (!source.ref.trim()) throw new Error('Submit source requires ref.')
  if (!/^[a-f0-9]{40}$/.test(source.commitSha)) throw new Error('Submit source requires full lowercase commitSha.')
  if (source.subdir && (source.subdir.startsWith('/') || source.subdir.split('/').includes('..'))) {
    throw new Error('Submit source subdir must be a safe relative path.')
  }
}

function assertSourceMatchesScan(source: SubmitSource, scanSource: SubmitSource) {
  const fields: Array<keyof SubmitSource> = ['repoUrl', 'owner', 'repo', 'ref', 'commitSha', 'subdir']
  const mismatched = fields.filter((field) => (source[field] ?? '') !== (scanSource[field] ?? ''))
  if (mismatched.length) {
    throw new Error(`Submit source does not match scan source: ${mismatched.join(', ')}`)
  }
}

function normalizeEnrichment(enrichment: SubmitEnrichmentDraft): SubmitEnrichmentDraft {
  return {
    ...(enrichment.displayName?.trim() ? { displayName: enrichment.displayName.trim() } : {}),
    ...(enrichment.description?.trim() ? { description: enrichment.description.trim() } : {}),
    ...(enrichment.keywords?.length ? { keywords: [...new Set(enrichment.keywords.map((keyword) => keyword.trim()).filter(Boolean))].sort() } : {}),
    ...(enrichment.summary?.trim() ? { summary: enrichment.summary.trim() } : {}),
    ...(enrichment.categories?.length ? { categories: [...new Set(enrichment.categories.map((category) => category.trim()).filter(Boolean))].sort() } : {}),
  }
}
