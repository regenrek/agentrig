import type { RepoScanReport } from '../repo-scan/types'
import type { ArtifactClosure, ArtifactClosureStatus, ArtifactFileDigest, ExtractedArtifact } from './extract-artifacts'
import { extractArtifactsFromRepoScan } from './extract-artifacts'
import { formatArtifactSelector, parseArtifactSelector, type ArtifactKind, type SelectableArtifactKind } from './artifact-kinds'

export const PUBLISH_SHAPE_KINDS = [
  'plugin_all',
  'plugin_selected',
  'standalone_artifacts',
  'discovery_only',
] as const

export type PublishShapeKind = (typeof PUBLISH_SHAPE_KINDS)[number]

export type PublishInstallability = 'installable' | 'discovery_only' | 'blocked'

export type SubmitSource = {
  repoUrl: string
  owner: string
  repo: string
  ref: string
  commitSha: string
  subdir?: string
}

export type PublishPluginCandidate = {
  artifactId: string
  version?: string
  sourcePath: string
  manifestPath: string
  files: ArtifactFileDigest[]
}

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

export type PublishShapeCandidate = {
  shape: PublishShapeKind
  label: string
  defaultSelected: boolean
  allowed: boolean
  blockedReason?: string
  selectedSelectors: string[]
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
    selectedSelectors: string[]
  }
  enrichment?: SubmitEnrichmentDraft
  review: SubmitReviewMetadata
}

export type BuildPublishScanResultInput = {
  source: SubmitSource
  report: Pick<RepoScanReport, 'signals' | 'digest'>
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

const PUBLISH_SHAPE_LABELS: Record<PublishShapeKind, string> = {
  plugin_all: 'Publish full plugin',
  plugin_selected: 'Publish selected artifacts as plugin',
  standalone_artifacts: 'Publish selected standalone artifacts',
  discovery_only: 'Discovery only',
}

export function buildPublishScanResult(input: BuildPublishScanResultInput): PublishScanResult {
  assertSubmitSource(input.source)
  if (!input.report.digest.trim()) throw new Error('Publish scan result requires scan digest.')
  if (!input.scannerVersion.trim()) throw new Error('Publish scan result requires scanner version.')

  const closures = new Map((input.closures ?? []).map((closure) => [closure.selector, closure]))
  const artifacts = extractArtifactsFromRepoScan(input.report)
    .map((artifact) => publishArtifactFromExtracted(artifact, closures.get(artifact.selector)))
    .sort((left, right) => left.selector.localeCompare(right.selector))

  return {
    scannerVersion: input.scannerVersion,
    scanDigest: input.report.digest,
    ...(input.treeSha ? { treeSha: input.treeSha } : {}),
    source: input.source,
    ...(input.pluginCandidate ? { pluginCandidate: normalizePluginCandidate(input.pluginCandidate) } : {}),
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
      selectedSelectors: candidate.selectedSelectors,
    },
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
  const shapeSelectors = shape === 'plugin_all' ? defaultSelectedSelectors(scan) : [...selectedSelectors]
  const selectedArtifacts = artifactsBySelector(scan, shapeSelectors)
  const blockedReason = blockedReasonForShape(scan, shape, selectedArtifacts)
  return {
    shape,
    label: PUBLISH_SHAPE_LABELS[shape],
    defaultSelected: false,
    allowed: !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
    selectedSelectors: shapeSelectors,
    produces: outputsForShape(scan, shape, selectedArtifacts, !blockedReason),
  }
}

function blockedReasonForShape(
  scan: PublishScanResult,
  shape: PublishShapeKind,
  selectedArtifacts: readonly PublishArtifact[]
) {
  if (shape === 'discovery_only') return undefined
  if (shape === 'plugin_all') {
    return scan.pluginCandidate ? undefined : 'plugin_all requires a detected plugin candidate.'
  }
  if (selectedArtifacts.length === 0) return `${shape} requires at least one selected artifact.`
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
  if (shape === 'plugin_selected') {
    return [{ kind: 'plugin', artifactId: scan.pluginCandidate?.artifactId, installability: allowed ? 'installable' : 'blocked' }]
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
  return scan.artifacts.map((artifact) => formatArtifactSelector(artifact.kind as SelectableArtifactKind, artifact.name))
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
