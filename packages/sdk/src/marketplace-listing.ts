import { z } from 'zod'
import {
  ARTIFACT_KINDS,
  CLI_SUPPORTED_ARTIFACT_KINDS,
  type ArtifactKind,
} from './provider/artifact-kinds'
import { isValidPluginName } from './provider/plugin-names'

const SHA256_HEX_RE = /^[a-f0-9]{64}$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const SUBMISSION_STATUSES = ['pending_review', 'approved', 'rejected', 'blocked'] as const
export const REGISTRY_MIRROR_STATUSES = ['queued', 'opened', 'merged', 'failed'] as const
export const MARKETPLACE_INSTALLABILITIES = ['available', 'yanked', 'taken_down'] as const
export const REGISTRY_TRUST_TIERS = ['official', 'reviewed', 'listed', 'blocked', 'yanked'] as const
export const INSTALLABILITY_STATES = ['installable', 'discovery_only', 'blocked', 'yanked'] as const

export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES)
export const RegistryMirrorStatusSchema = z.enum(REGISTRY_MIRROR_STATUSES)
export const MarketplaceInstallabilitySchema = z.enum(MARKETPLACE_INSTALLABILITIES)
export const RegistryTrustTierSchema = z.enum(REGISTRY_TRUST_TIERS)
export const InstallabilityStateSchema = z.enum(INSTALLABILITY_STATES)
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS)
export const CliSupportedKindSchema = z.enum(CLI_SUPPORTED_ARTIFACT_KINDS)

export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>
export type RegistryMirrorStatus = z.infer<typeof RegistryMirrorStatusSchema>
export type MarketplaceInstallability = z.infer<typeof MarketplaceInstallabilitySchema>
export type RegistryTrustTier = z.infer<typeof RegistryTrustTierSchema>
export type CanonicalTrustTier = RegistryTrustTier
export type TrustTier = RegistryTrustTier
export type InstallabilityState = z.infer<typeof InstallabilityStateSchema>
export type RegistryInstallability = InstallabilityState

const MarketplaceListingPublicBaseSchema = z.object({
  kind: CliSupportedKindSchema,
  origin: z.enum(['standalone', 'bundled']),
  artifactId: z.string().trim().min(1),
  slug: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  description: z.string(),
  version: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  license: z.string().trim().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  capabilityTags: z.array(z.string()).optional(),
  source: z.string().trim().min(1),
  sourceType: z
    .enum(['submission', 'registry', 'github_repo', 'claimed_project', 'mcp', 'manual_curation'])
    .optional(),
  sourceUrl: z.string().trim().min(1).optional(),
  sourceRepoFullName: z.string().trim().min(1).optional(),
  parentArtifactId: z.string().trim().min(1).optional(),
  publishShape: z.string().trim().min(1).optional(),
  registryAlias: z.string().trim().min(1).optional(),
  registryArtifactId: z.string().trim().min(1).optional(),
  registryVersion: z.string().trim().min(1).optional(),
  registryTrustTier: RegistryTrustTierSchema.optional(),
  registryInstallability: InstallabilityStateSchema.optional(),
  registrySourceRepository: z.string().trim().min(1).optional(),
  registrySnapshotDigest: z.string().trim().min(1).optional(),
  installability: MarketplaceInstallabilitySchema,
  publishedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const MarketplaceListingPublicSchema = MarketplaceListingPublicBaseSchema
export type MarketplaceListingPublic = z.infer<typeof MarketplaceListingPublicSchema>

export const MarketplaceListingInternalSchema = MarketplaceListingPublicBaseSchema.extend({
  listingId: z.string().trim().min(1).optional(),
  verificationTier: z.string().trim().min(1).optional(),
  submissionId: z.string().trim().min(1).optional(),
  ownerUserId: z.string().trim().min(1).optional(),
  canonicalEntryId: z.string().trim().min(1).optional(),
  parentArtifactListingId: z.string().trim().min(1).optional(),
  directoryState: z.enum(['listed', 'reviewed', 'official', 'blocked', 'yanked', 'delisted']).optional(),
  directoryReviewStatus: z.enum(['unreviewed', 'reviewed', 'official', 'rejected']).optional(),
  authorVerificationStatus: z.enum(['unverified', 'verified_author', 'verified_org']).optional(),
  moderationState: z.enum(['active', 'blocked', 'yanked', 'delisted']).optional(),
  advisoryState: z.enum(['none', 'active']).optional(),
  curatedBy: z.string().trim().min(1).optional(),
  lastVerifiedAt: z.number().int().nonnegative().optional(),
  lastRefreshedAt: z.number().int().nonnegative().optional(),
  sourceRepoId: z.number().int().nonnegative().optional(),
  registryHistoryPath: z.string().trim().min(1).optional(),
  registryLinkedAt: z.number().int().nonnegative().optional(),
  registryMirrorStatus: RegistryMirrorStatusSchema.optional(),
  likeCountAllTime: z.number().int().nonnegative().optional(),
  yankReason: z.string().trim().min(1).optional(),
  yankedAt: z.number().int().nonnegative().optional(),
})

export type MarketplaceListingInternal = z.infer<typeof MarketplaceListingInternalSchema>

// Back-compat for server-side Convex code in this monorepo. New public wire
// contracts should use MarketplaceListingPublicSchema/MarketplaceListingPublic.
export const MarketplaceListingSchema = MarketplaceListingInternalSchema
export type MarketplaceListing = MarketplaceListingInternal

export const InstallBundleFileSchema = z.object({
  path: z.string().trim().min(1),
  sha256: z.string().regex(SHA256_HEX_RE, 'Expected lowercase SHA-256 hex digest'),
  size: z.number().int().nonnegative(),
  sourcePath: z.string().trim().min(1).optional(),
  storageId: z.string().trim().min(1).optional(),
  contentType: z.string().trim().min(1).optional(),
  // Pre-signed download URL for files that cannot be reconstructed from
  // `source` (synthesized manifests, Convex-stored payloads). When present,
  // the consumer must prefer this over the `source`-derived URL.
  url: z.string().trim().min(1).optional(),
  // Base64-encoded inline payload for synthesized files (e.g. server-built
  // `.plugin/plugin.json`) that have no upstream source bytes. When present,
  // the consumer must use these bytes directly and skip any network fetch.
  inline: z.string().trim().min(1).optional(),
})

export type InstallBundleFile = z.infer<typeof InstallBundleFileSchema>

export const InstallBundleReadmeFileSchema = z.object({
  path: z.literal('README.md'),
  sha256: z.string().regex(SHA256_HEX_RE, 'Expected lowercase SHA-256 hex digest'),
  size: z.number().int().nonnegative(),
  storageId: z.string().trim().min(1).optional(),
})

export type InstallBundleReadmeFile = z.infer<typeof InstallBundleReadmeFileSchema>

export const InstallBundleSourceSchema = z.object({
  type: z.enum(['github', 'registry', 'convex_storage', 'archive']),
  url: z.string().trim().min(1).optional(),
  ref: z.string().trim().min(1).optional(),
  commitSha: z.string().trim().min(1).optional(),
  subdir: z.string().trim().min(1).optional(),
})

export type InstallBundleSource = z.infer<typeof InstallBundleSourceSchema>

export const InstallBundleSchema = z.object({
  schemaVersion: z.literal(1),
  listing: MarketplaceListingPublicSchema,
  source: InstallBundleSourceSchema,
  readmeFile: InstallBundleReadmeFileSchema.optional(),
  file_list: z.array(InstallBundleFileSchema).min(1),
})

export type InstallBundle = z.infer<typeof InstallBundleSchema>

export const ListingInstallResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolvable'),
    listing: MarketplaceListingPublicSchema,
    bundle: InstallBundleSchema,
  }),
  z.object({
    status: z.literal('unresolvable'),
    listing: MarketplaceListingPublicSchema.optional(),
    reason: z.enum(['not_found', 'yanked', 'taken_down', 'invalid_bundle']),
    message: z.string().trim().min(1).optional(),
  }),
])

export type ListingInstallResolution = z.infer<typeof ListingInstallResolutionSchema>

export type VerifyIssue = {
  path: string
  // `extra` is the hard-cut issue code for fetched bytes that are not declared in file_list.
  code: 'not_written' | 'not_fetched' | 'duplicate' | 'size_mismatch' | 'hash_mismatch' | 'extra'
  expected?: string | number
  actual?: string | number
  error?: string
  status?: number
  url?: string
  bodySnippet?: string
}

export type VerifyResult =
  | {
      ok: true
      checked: number
      issues: []
    }
  | {
      ok: false
      checked: number
      issues: VerifyIssue[]
    }

export type FetchedInstallFileBytes = Uint8Array | ArrayBuffer | string

export type FetchedInstallFile =
  | {
      path: string
      bytes: FetchedInstallFileBytes
      missing?: false
    }
  | {
      path: string
      missing: true
      error?: string
      status?: number
      url?: string
      bodySnippet?: string
    }

export async function verifyInstallBundleHashes(
  bundle: InstallBundle,
  fetchedFiles: readonly FetchedInstallFile[]
): Promise<VerifyResult> {
  const fetchedByPath = new Map<string, Uint8Array>()
  const missingByPath = new Map<string, Extract<FetchedInstallFile, { missing: true }>>()
  const duplicatePaths = new Set<string>()

  for (const file of fetchedFiles) {
    if (file.missing) {
      if (!missingByPath.has(file.path)) missingByPath.set(file.path, file)
      continue
    }
    const bytes = bytesFromFetchedFile(file.bytes)
    if (fetchedByPath.has(file.path)) duplicatePaths.add(file.path)
    fetchedByPath.set(file.path, bytes)
  }

  const issues: VerifyIssue[] = [...duplicatePaths].sort().map((path) => ({
    path,
    code: 'duplicate' as const,
  }))

  const expectedPaths = new Set(bundle.file_list.map((file) => file.path))
  let checked = 0
  for (const expected of bundle.file_list) {
    const bytes = fetchedByPath.get(expected.path)
    if (!bytes) {
      const missing = missingByPath.get(expected.path)
      issues.push(formatMissingInstallFileIssue(expected.path, missing))
      continue
    }

    checked += 1
    if (bytes.byteLength !== expected.size) {
      issues.push({
        path: expected.path,
        code: 'size_mismatch',
        expected: expected.size,
        actual: bytes.byteLength,
      })
    }

    const actualSha256 = await sha256Hex(bytes)
    if (actualSha256 !== expected.sha256) {
      issues.push({
        path: expected.path,
        code: 'hash_mismatch',
        expected: expected.sha256,
        actual: actualSha256,
      })
    }
  }

  for (const path of [...fetchedByPath.keys()].sort()) {
    if (!expectedPaths.has(path)) {
      issues.push({ path, code: 'extra' })
    }
  }

  return issues.length ? { ok: false, checked, issues } : { ok: true, checked, issues: [] }
}

function formatMissingInstallFileIssue(
  path: string,
  missing: Extract<FetchedInstallFile, { missing: true }> | undefined
): VerifyIssue {
  if (!missing) return { path, code: 'not_written' }
  if (typeof missing.status === 'number' || missing.url) {
    return {
      path,
      code: 'not_fetched',
      error: missing.error,
      status: missing.status,
      url: missing.url,
      bodySnippet: missing.bodySnippet,
    }
  }
  return {
    path,
    code: 'not_written',
    error: missing.error,
  }
}

export function isResolvable(listing: Pick<MarketplaceListingPublic, 'installability'>): boolean {
  return listing.installability === 'available'
}

export type RegistryRef = {
  name: string
  url: string
}

export type DirectoryEntry = {
  name: string
  homepage?: string
  url: string
  description?: string
  logo?: string
  verified?: boolean
  installability: 'discovery_only'
  tags?: string[]
  keywords?: string[]
}

const OpenPluginAuthorSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
}).strict()

const AgentRigPluginExtensionSchema = z.object({
  displayName: z.string().optional(),
  kind: z.string().optional(),
  configSchema: z.record(z.string(), z.any()).optional(),
  pluginDependencies: z.array(z.string()).optional(),
})

export const PluginManifestSchema = z.object({
  $schema: z.string().trim().min(1).optional(),
  name: z.string().trim().refine(
    isValidPluginName,
    'Open Plugins name must be 1-64 lowercase letters, numbers, dots, or hyphens; start and end alphanumeric; and not contain "--" or ".."',
  ),
  description: z.string().optional(),
  version: z.string().trim().regex(SEMVER_RE, 'Plugin version must be valid semver (x.y.z)').optional(),
  author: OpenPluginAuthorSchema.optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  logo: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  'x-agentrig': AgentRigPluginExtensionSchema.optional(),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

export type RegistryFileDigest = {
  path: string
  digest: string
  size: number
}

export type RegistryVersionDependency = {
  plugin: string
  version: string
}

export type RegistrySignatureEnvelope = {
  algorithm: string
  key_id: string
  target?: string
  signed_digest: string
}

export type RegistryVersionRecord = {
  version: string
  path: string
  manifest: string
  source: string
  lock: string
  review: string
  trust_tier: TrustTier
  installability: RegistryInstallability
  snapshot_digest: string
  published_at: string
}

export type RegistryHistory = {
  $schema?: string
  kind: ArtifactKind
  artifact: string
  plugin?: string
  namespace: string
  name: string
  description: string
  latest_version: string
  trust_tier: TrustTier
  installability: RegistryInstallability
  active_version: RegistryVersionRecord
  keywords?: string[]
  advisories?: string[]
  versions: RegistryVersionRecord[]
}

export type RegistryIndexItem = {
  kind: ArtifactKind
  artifact: string
  plugin?: string
  name: string
  description: string
  latest_version: string
  history: string
  active_version: RegistryVersionRecord
  trust_tier: TrustTier
  installability: RegistryInstallability
  keywords?: string[]
  advisories?: string[]
  summary?: string
}

export type RegistryIndex = {
  $schema?: string
  contract_version: string
  registry_alias: string
  source_repository: string
  generated_at: string
  signature: RegistrySignatureEnvelope
  items: RegistryIndexItem[]
}

export type RegistryLock = {
  $schema?: string
  plugin?: string
  artifact_kind?: ArtifactKind
  artifact_id?: string
  version: string
  file_digests: RegistryFileDigest[]
  capability_set: string[]
  declared_network_domains: string[]
  declared_secrets: string[]
  runtime_requirements: string[]
  dependencies: RegistryVersionDependency[]
  snapshot_digest: string
}

export type RegistrySource = {
  $schema?: string
  upstream_repo: string
  upstream_tag: string
  upstream_commit: string
  plugin_path?: string
  artifact_kind?: ArtifactKind
  artifact_path?: string
  submitted_by: string
  snapshot_created_at: string
  snapshot_tree_digest: string
}

export type RegistryReview = {
  $schema?: string
  review_status: string
  reviewer: string
  reviewed_at: string
  scanner_summary: {
    status: string
    findings?: string[]
  }
  policy_decisions: string[]
  trust_tier_basis: {
    trust_tier: TrustTier
    installability: RegistryInstallability
    rationale: string
  }
}

export type RegistryDisplayFile = {
  path: string
  mode?: string
  sha256: string
  size: number
}

export function pluginFilesFromLock(lock: RegistryLock): RegistryDisplayFile[] {
  return lock.file_digests.map((entry) => ({
    path: entry.path,
    sha256: entry.digest,
    size: entry.size,
  }))
}

export const RegistryFileDigestSchema = z.object({
  path: z.string().trim().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
})

export const RegistryVersionDependencySchema = z.object({
  plugin: z.string().trim().min(1),
  version: z.string().trim().min(1),
})

export const RegistrySignatureEnvelopeSchema = z.object({
  algorithm: z.string().trim().min(1),
  key_id: z.string().trim().min(1),
  target: z.string().trim().min(1).optional(),
  signed_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})

export const RegistryVersionRecordSchema = z.object({
  version: z.string().trim().min(1),
  path: z.string().trim().min(1),
  manifest: z.string().trim().min(1),
  source: z.string().trim().min(1),
  lock: z.string().trim().min(1),
  review: z.string().trim().min(1),
  trust_tier: RegistryTrustTierSchema,
  installability: InstallabilityStateSchema,
  snapshot_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  published_at: z.string().trim().min(1),
})

export const RegistryHistorySchema = z.object({
  $schema: z.string().trim().min(1).optional(),
  kind: ArtifactKindSchema,
  artifact: z.string().trim().min(1),
  plugin: z.string().trim().min(1).optional(),
  namespace: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
  latest_version: z.string().trim().min(1),
  trust_tier: RegistryTrustTierSchema,
  installability: InstallabilityStateSchema,
  active_version: RegistryVersionRecordSchema,
  keywords: z.array(z.string()).optional(),
  advisories: z.array(z.string()).optional(),
  versions: z.array(RegistryVersionRecordSchema).min(1),
})

export const RegistryIndexItemSchema = z.object({
  kind: ArtifactKindSchema,
  artifact: z.string().trim().min(1),
  plugin: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  description: z.string(),
  latest_version: z.string().trim().min(1),
  history: z.string().trim().min(1),
  active_version: RegistryVersionRecordSchema,
  trust_tier: RegistryTrustTierSchema,
  installability: InstallabilityStateSchema,
  keywords: z.array(z.string()).optional(),
  advisories: z.array(z.string()).optional(),
  summary: z.string().optional(),
})

export const RegistryIndexSchema = z.object({
  $schema: z.string().trim().min(1).optional(),
  contract_version: z.string().trim().min(1),
  registry_alias: z.string().trim().min(1),
  source_repository: z.string().trim().min(1),
  generated_at: z.string().trim().min(1),
  signature: RegistrySignatureEnvelopeSchema,
  items: z.array(RegistryIndexItemSchema),
})

export const RegistryLockSchema = z.object({
  $schema: z.string().trim().min(1).optional(),
  plugin: z.string().trim().min(1).optional(),
  artifact_kind: ArtifactKindSchema.optional(),
  artifact_id: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1),
  file_digests: z.array(RegistryFileDigestSchema).min(1),
  capability_set: z.array(z.string()),
  declared_network_domains: z.array(z.string()),
  declared_secrets: z.array(z.string()),
  runtime_requirements: z.array(z.string()),
  dependencies: z.array(RegistryVersionDependencySchema),
  snapshot_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})

export type RegistryMirrorFetchedFile = {
  path: string
  bytes: FetchedInstallFileBytes
}

export type RegistryMirrorArtifacts = {
  generatedFiles: Array<{ path: string; content: string }>
  historyDocument: RegistryHistory
  registryDocument: RegistryIndex
  advisoriesDocument: Record<string, unknown>
  sourceArtifact: RegistrySource
  lockArtifact: RegistryLock
  reviewArtifact: RegistryReview
  prTitle: string
  prBody: string
  commitMessage: string
  branchName: string
  snapshotTreeDigest: string
  artifactDigest: string
  warnings: string[]
  findings: Array<{ severity: 'error' | 'warning'; code: string; message: string }>
  policyDecisions: string[]
  alreadyPublished: boolean
}

export async function buildRegistryMirrorArtifactsFromInstallBundle(args: {
  bundle: InstallBundle
  files: readonly RegistryMirrorFetchedFile[]
  submissionId: string
  reviewedAt: number
  reviewedBy?: string
  advisoriesDocument: Record<string, unknown>
  registryDocument?: RegistryIndex | null
  existingHistoryDocument?: RegistryHistory | null
}): Promise<RegistryMirrorArtifacts> {
  const bundle = InstallBundleSchema.parse(args.bundle)
  if (!isResolvable(bundle.listing)) {
    throw new Error(`Cannot mirror non-available listing: ${bundle.listing.installability}`)
  }

  const listing = bundle.listing
  const artifactId = listing.registryArtifactId ?? listing.artifactId
  const [namespace, artifactName] = splitArtifactId(artifactId)
  const kind = listing.kind
  const layout = registryLayoutForKind(kind)
  const version = listing.registryVersion ?? listing.version
  const versionRoot = `${layout.root}/${namespace}/${artifactName}/versions/${version}`
  const manifestPath = `${versionRoot}/${layout.manifestDir}/${layout.manifestFile}`
  const historyPath = `${layout.root}/${namespace}/${artifactName}/${layout.historyFile}`
  const reviewedAtIso = new Date(args.reviewedAt).toISOString()
  const source = bundle.source

  const fileBytesByPath = new Map(args.files.map((file) => [file.path, bytesFromFetchedFile(file.bytes)]))
  const payloadFiles = bundle.file_list.map((file) => {
    const bytes = fileBytesByPath.get(file.path)
    if (!bytes) throw new Error(`Missing fetched install bundle file: ${file.path}`)
    if (bytes.byteLength !== file.size) {
      throw new Error(`Fetched install bundle file size mismatch for ${file.path}`)
    }
    return { ...file, bytes }
  })
  const verified = await verifyInstallBundleHashes(
    bundle,
    payloadFiles.map((file) => ({ path: file.path, bytes: file.bytes })),
  )
  if (!verified.ok) {
    throw new Error(`Fetched install bundle file hash mismatch: ${verified.issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`)
  }

  const fileDigests = bundle.file_list
    .map((file) => ({
      path: file.path,
      digest: sha256Digest(file.sha256),
      size: file.size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  const snapshotTreeDigest = await digestJson(fileDigests)
  const registryTrustTier = listing.registryTrustTier ?? 'reviewed'
  const registryInstallability = listing.registryInstallability ?? 'installable'
  const existingVersions = args.existingHistoryDocument?.versions ?? []
  const existingSameVersion = existingVersions.find((record) => record.version === version)
  if (existingSameVersion && existingSameVersion.snapshot_digest !== snapshotTreeDigest) {
    throw new Error(`Registry already contains ${artifactId}@${version} with a different snapshot digest.`)
  }
  const alreadyPublished = existingSameVersion?.snapshot_digest === snapshotTreeDigest

  const sourceArtifact = sortKeys({
    $schema: 'https://agentrig.ai/schema/agentrig-source.json',
    upstream_repo: source.url ?? listing.sourceUrl ?? listing.source,
    upstream_tag: source.ref ?? version,
    upstream_commit: source.commitSha ?? '',
    submitted_by: `submission:${args.submissionId}`,
    snapshot_created_at: new Date(listing.publishedAt).toISOString(),
    snapshot_tree_digest: snapshotTreeDigest,
    ...(kind === 'plugin'
      ? { plugin_path: source.subdir ?? '.' }
      : { artifact_kind: kind, artifact_path: source.subdir ?? '.' }),
  }) as RegistrySource

  const lockArtifact = RegistryLockSchema.parse(sortKeys({
    $schema: 'https://agentrig.ai/schema/agentrig-lock.json',
    ...(kind === 'plugin' ? { plugin: artifactId } : { artifact_kind: kind, artifact_id: artifactId }),
    version,
    file_digests: fileDigests,
    capability_set: listing.capabilityTags ?? [],
    declared_network_domains: [],
    declared_secrets: [],
    runtime_requirements: [],
    dependencies: [],
    snapshot_digest: snapshotTreeDigest,
  }))

  const reviewArtifact = sortKeys({
    $schema: 'https://agentrig.ai/schema/agentrig-review.json',
    review_status: 'approved',
    reviewer: args.reviewedBy ? `user:${args.reviewedBy}` : 'system:review-approval',
    reviewed_at: reviewedAtIso,
    scanner_summary: { status: 'pass' },
    policy_decisions: [
      'mirror_input_is_sdk_install_bundle',
      'install_bundle_hashes_verified',
      'listing_installability_available',
    ],
    trust_tier_basis: {
      trust_tier: registryTrustTier,
      installability: registryInstallability,
      rationale: 'This registry entry mirrors a Convex-approved AgentRig marketplace listing.',
    },
  }) as RegistryReview

  const newVersionRecord = RegistryVersionRecordSchema.parse(sortKeys({
    version,
    path: `${versionRoot}/`,
    manifest: manifestPath,
    source: `${versionRoot}/AGENTRIG_SOURCE.json`,
    lock: `${versionRoot}/AGENTRIG_LOCK.json`,
    review: `${versionRoot}/AGENTRIG_REVIEW.json`,
    trust_tier: registryTrustTier,
    installability: registryInstallability,
    snapshot_digest: snapshotTreeDigest,
    published_at: reviewedAtIso,
  }))
  const versions = existingVersions
    .filter((record) => record.version !== version)
    .concat(newVersionRecord)
    .sort((left, right) => right.version.localeCompare(left.version))
  const advisoryIds = Array.isArray(args.advisoriesDocument.items)
    ? args.advisoriesDocument.items
        .filter((item) => isRecord(item) && item.plugin === artifactId)
        .map((item) => String(item.id ?? ''))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
    : []

  const historyDocument = RegistryHistorySchema.parse(sortKeys({
    $schema: 'https://agentrig.ai/schema/plugin-history.json',
    kind,
    artifact: artifactId,
    ...(kind === 'plugin' ? { plugin: artifactId } : {}),
    namespace,
    name: listing.name,
    description: listing.description,
    latest_version: versions[0]!.version,
    trust_tier: versions[0]!.trust_tier,
    installability: versions[0]!.installability,
    active_version: versions[0],
    keywords: listing.keywords?.length ? listing.keywords : undefined,
    advisories: advisoryIds.length ? advisoryIds : undefined,
    versions,
  }))

  const registryItems = (args.registryDocument?.items ?? [])
    .filter((item) => item.artifact !== artifactId)
    .concat(sortKeys({
      kind,
      artifact: artifactId,
      ...(kind === 'plugin' ? { plugin: artifactId } : {}),
      name: listing.name,
      description: listing.description,
      latest_version: historyDocument.latest_version,
      history: historyPath,
      active_version: historyDocument.active_version,
      trust_tier: historyDocument.trust_tier,
      installability: historyDocument.installability,
      keywords: historyDocument.keywords,
      advisories: historyDocument.advisories,
    }))
    .sort((left, right) => {
      const kindComparison = left.kind.localeCompare(right.kind)
      return kindComparison || left.artifact.localeCompare(right.artifact)
    })
  const advisoriesDocument = sortKeys(args.advisoriesDocument)
  const generatedAt = [String((advisoriesDocument as Record<string, unknown>).generated_at ?? ''), reviewedAtIso]
    .filter(Boolean)
    .sort()
    .at(-1) ?? reviewedAtIso
  const unsignedRegistry = sortKeys({
    $schema: 'https://agentrig.ai/schema/registry.json',
    contract_version: '1',
    registry_alias: 'agentrig',
    source_repository: 'https://github.com/agentrig/agentrig-registry',
    generated_at: generatedAt,
    items: registryItems,
  })
  const registryDocument = RegistryIndexSchema.parse(sortKeys({
    ...unsignedRegistry,
    signature: {
      algorithm: 'sha256-json-envelope',
      key_id: 'agentrig-registry',
      target: 'registry.json',
      signed_digest: await digestJson(unsignedRegistry),
    },
  }))

  const generatedFiles = [
    ...payloadFiles.map((file) => ({
      path: `${versionRoot}/${file.path}`,
      content: new TextDecoder().decode(file.bytes),
    })),
    { path: `${versionRoot}/AGENTRIG_SOURCE.json`, content: stableJsonPretty(sourceArtifact) },
    { path: `${versionRoot}/AGENTRIG_LOCK.json`, content: stableJsonPretty(lockArtifact) },
    { path: `${versionRoot}/AGENTRIG_REVIEW.json`, content: stableJsonPretty(reviewArtifact) },
    { path: historyPath, content: stableJsonPretty(historyDocument) },
    { path: 'advisories.json', content: stableJsonPretty(advisoriesDocument) },
    { path: 'registry.json', content: stableJsonPretty(registryDocument) },
  ].sort((left, right) => left.path.localeCompare(right.path))

  const artifactDigest = await digestJson(await Promise.all(
    generatedFiles.map(async (file) => ({
      path: file.path,
      digest: `sha256:${await sha256Hex(new TextEncoder().encode(file.content))}`,
    })),
  ))
  const branchName = `promotion/${artifactId.replace(/\./g, '-')}-${version}-${(source.commitSha ?? 'mirror').slice(0, 12)}`

  return {
    generatedFiles,
    historyDocument,
    registryDocument,
    advisoriesDocument,
    sourceArtifact,
    lockArtifact,
    reviewArtifact,
    prTitle: `Mirror ${artifactId}@${version}`,
    prBody: `## Summary\n- Mirror \`${artifactId}@${version}\` from marketplace artifact \`${listing.artifactId}\`\n- Source: \`${source.url ?? listing.source}\` @ \`${source.ref ?? version}\` (${source.commitSha ?? 'unknown commit'})\n- Serializer: SDK InstallBundle\n\n## Test plan\n- [ ] Registry CI passes on this PR\n- [ ] Maintainer confirms the mirrored entry matches the approved marketplace listing\n`,
    commitMessage: `Mirror ${artifactId}@${version}\n\nDerived from AgentRig marketplace InstallBundle for submission ${args.submissionId}.`,
    branchName,
    snapshotTreeDigest,
    artifactDigest,
    warnings: [],
    findings: [],
    policyDecisions: ['mirror_input_is_sdk_install_bundle'],
    alreadyPublished,
  }
}

export async function buildRegistryYankMirrorArtifacts(args: {
  listing: MarketplaceListing
  registryDocument: RegistryIndex
  existingHistoryDocument: RegistryHistory
  reason?: string
  changedAt: number
}): Promise<RegistryMirrorArtifacts> {
  const listing = MarketplaceListingSchema.parse(args.listing)
  const artifactId = listing.registryArtifactId ?? listing.artifactId
  const [namespace, artifactName] = splitArtifactId(artifactId)
  const layout = registryLayoutForKind(listing.kind)
  const historyPath = `${layout.root}/${namespace}/${artifactName}/${layout.historyFile}`
  const changedAtIso = new Date(args.changedAt).toISOString()
  const yankedVersions = args.existingHistoryDocument.versions.map((version, index) =>
    index === 0
      ? RegistryVersionRecordSchema.parse(sortKeys({
          ...version,
          trust_tier: 'yanked',
          installability: 'yanked',
        }))
      : version,
  )
  const active = yankedVersions[0]
  if (!active) throw new Error(`Cannot mark ${artifactId} as yanked without registry history.`)
  const historyDocument = RegistryHistorySchema.parse(sortKeys({
    ...args.existingHistoryDocument,
    trust_tier: 'yanked',
    installability: 'yanked',
    active_version: active,
    versions: yankedVersions,
  }))
  const registryItems = args.registryDocument.items
    .map((item) =>
      item.artifact === artifactId
        ? sortKeys({
            ...item,
            trust_tier: 'yanked',
            installability: 'yanked',
            active_version: active,
          })
        : item,
    )
    .sort((left, right) => {
      const kindComparison = left.kind.localeCompare(right.kind)
      return kindComparison || left.artifact.localeCompare(right.artifact)
    })
  const unsignedRegistry = sortKeys({
    ...args.registryDocument,
    signature: undefined,
    generated_at: changedAtIso,
    items: registryItems,
  })
  const registryDocument = RegistryIndexSchema.parse(sortKeys({
    ...unsignedRegistry,
    signature: {
      algorithm: 'sha256-json-envelope',
      key_id: 'agentrig-registry',
      target: 'registry.json',
      signed_digest: await digestJson(unsignedRegistry),
    },
  }))
  const generatedFiles = [
    { path: historyPath, content: stableJsonPretty(historyDocument) },
    { path: 'registry.json', content: stableJsonPretty(registryDocument) },
  ]
  const artifactDigest = await digestJson(await Promise.all(
    generatedFiles.map(async (file) => ({
      path: file.path,
      digest: `sha256:${await sha256Hex(new TextEncoder().encode(file.content))}`,
    })),
  ))

  return {
    generatedFiles,
    historyDocument,
    registryDocument,
    advisoriesDocument: {},
    sourceArtifact: {} as RegistrySource,
    lockArtifact: {} as RegistryLock,
    reviewArtifact: {} as RegistryReview,
    prTitle: `Mark ${artifactId} as yanked`,
    prBody: `## Summary\n- Mark \`${artifactId}\` as yanked in the verified registry mirror\n- Marketplace listing installability: \`${listing.installability}\`\n- Reason: ${args.reason ?? listing.yankReason ?? 'not specified'}\n\n## Test plan\n- [ ] Registry CI passes on this PR\n- [ ] Maintainer confirms Convex install resolution refuses this listing\n`,
    commitMessage: `Mark ${artifactId} as yanked\n\nMarketplace artifact ${listing.artifactId} is no longer available.`,
    branchName: `mirror-yank/${artifactId.replace(/\./g, '-')}-${String(args.changedAt).slice(-10)}`,
    snapshotTreeDigest: active.snapshot_digest,
    artifactDigest,
    warnings: [],
    findings: [],
    policyDecisions: ['mirror_followup_marks_yanked_listing'],
    alreadyPublished: args.existingHistoryDocument.installability === 'yanked',
  }
}

function bytesFromFetchedFile(value: FetchedInstallFileBytes) {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}

function registryLayoutForKind(kind: ArtifactKind) {
  if (kind === 'plugin') {
    return { root: 'plugins', historyFile: 'plugin.json', manifestDir: '.plugin', manifestFile: 'plugin.json' }
  }
  if (kind === 'skill') {
    return { root: 'skills', historyFile: 'skill.json', manifestDir: '.skill', manifestFile: 'skill.json' }
  }
  if (kind === 'mcp') {
    return { root: 'mcps', historyFile: 'mcp.json', manifestDir: '.mcp', manifestFile: 'mcp.json' }
  }
  return { root: 'hooks', historyFile: 'hook.json', manifestDir: '.hook', manifestFile: 'hook.json' }
}

function splitArtifactId(artifactId: string) {
  const [namespace, artifactName] = artifactId.split('.')
  if (!namespace || !artifactName) throw new Error(`Invalid registry artifact id: ${artifactId}`)
  return [namespace, artifactName] as const
}

function sha256Digest(value: string) {
  const digest = value.trim().replace(/^sha256:/, '').toLowerCase()
  if (!SHA256_HEX_RE.test(digest)) throw new Error(`Invalid SHA-256 digest: ${value}`)
  return `sha256:${digest}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item)) as T
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    ) as T
  }
  return value
}

function stableJson(value: unknown) {
  return JSON.stringify(sortKeys(value))
}

function stableJsonPretty(value: unknown) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

async function digestJson(value: unknown) {
  return `sha256:${await sha256Hex(new TextEncoder().encode(stableJson(value)))}`
}

async function sha256Hex(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 digest requires Web Crypto support')
  }
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
