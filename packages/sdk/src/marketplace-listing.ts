import { z } from 'zod'
import { ARTIFACT_KINDS, type ArtifactKind } from './provider/artifact-kinds'

const SHA256_HEX_RE = /^[a-f0-9]{64}$/

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

export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>
export type RegistryMirrorStatus = z.infer<typeof RegistryMirrorStatusSchema>
export type MarketplaceInstallability = z.infer<typeof MarketplaceInstallabilitySchema>
export type RegistryTrustTier = z.infer<typeof RegistryTrustTierSchema>
export type CanonicalTrustTier = RegistryTrustTier
export type TrustTier = RegistryTrustTier
export type InstallabilityState = z.infer<typeof InstallabilityStateSchema>
export type RegistryInstallability = InstallabilityState

export const MarketplaceListingSchema = z.object({
  listingId: z.string().trim().min(1).optional(),
  kind: ArtifactKindSchema,
  origin: z.enum(['standalone', 'bundled']),
  artifactId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
  version: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  license: z.string().trim().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  capabilityTags: z.array(z.string()).optional(),
  verificationTier: z.string().trim().min(1).optional(),
  submissionId: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1),
  sourceType: z
    .enum(['submission', 'registry', 'github_repo', 'claimed_project', 'mcp', 'manual_curation'])
    .optional(),
  sourceUrl: z.string().trim().min(1).optional(),
  ownerUserId: z.string().trim().min(1).optional(),
  canonicalEntryId: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  parentArtifactListingId: z.string().trim().min(1).optional(),
  parentArtifactId: z.string().trim().min(1).optional(),
  directoryState: z.enum(['listed', 'reviewed', 'official', 'blocked', 'yanked', 'delisted']).optional(),
  directoryReviewStatus: z.enum(['unreviewed', 'reviewed', 'official', 'rejected']).optional(),
  authorVerificationStatus: z.enum(['unverified', 'verified_author', 'verified_org']).optional(),
  moderationState: z.enum(['active', 'blocked', 'yanked', 'delisted']).optional(),
  advisoryState: z.enum(['none', 'active']).optional(),
  curatedBy: z.string().trim().min(1).optional(),
  lastVerifiedAt: z.number().int().nonnegative().optional(),
  lastRefreshedAt: z.number().int().nonnegative().optional(),
  sourceRepoId: z.number().int().nonnegative().optional(),
  sourceRepoFullName: z.string().trim().min(1).optional(),
  registryAlias: z.string().trim().min(1).optional(),
  registryArtifactId: z.string().trim().min(1).optional(),
  registryVersion: z.string().trim().min(1).optional(),
  registryTrustTier: RegistryTrustTierSchema.optional(),
  registryInstallability: InstallabilityStateSchema.optional(),
  registryHistoryPath: z.string().trim().min(1).optional(),
  registryLinkedAt: z.number().int().nonnegative().optional(),
  registrySourceRepository: z.string().trim().min(1).optional(),
  registrySnapshotDigest: z.string().trim().min(1).optional(),
  registryMirrorStatus: RegistryMirrorStatusSchema.optional(),
  likeCountAllTime: z.number().int().nonnegative().optional(),
  installability: MarketplaceInstallabilitySchema,
  yankReason: z.string().trim().min(1).optional(),
  yankedAt: z.number().int().nonnegative().optional(),
  publishedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>

export const InstallBundleFileSchema = z.object({
  path: z.string().trim().min(1),
  sha256: z.string().regex(SHA256_HEX_RE, 'Expected lowercase SHA-256 hex digest'),
  size: z.number().int().nonnegative(),
  sourcePath: z.string().trim().min(1).optional(),
  storageId: z.string().trim().min(1).optional(),
  contentType: z.string().trim().min(1).optional(),
})

export type InstallBundleFile = z.infer<typeof InstallBundleFileSchema>

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
  listing: MarketplaceListingSchema,
  source: InstallBundleSourceSchema,
  file_list: z.array(InstallBundleFileSchema).min(1),
})

export type InstallBundle = z.infer<typeof InstallBundleSchema>

export const ListingInstallResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolvable'),
    listing: MarketplaceListingSchema,
    bundle: InstallBundleSchema,
  }),
  z.object({
    status: z.literal('unresolvable'),
    listing: MarketplaceListingSchema.optional(),
    reason: z.enum(['not_found', 'yanked', 'taken_down', 'invalid_bundle']),
    message: z.string().trim().min(1).optional(),
  }),
])

export type ListingInstallResolution = z.infer<typeof ListingInstallResolutionSchema>

export type VerifyIssue = {
  path: string
  code: 'missing' | 'duplicate' | 'size_mismatch' | 'sha256_mismatch'
  expected?: string | number
  actual?: string | number
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

export type FetchedInstallFile = {
  path: string
  bytes: Uint8Array | ArrayBuffer | string
}

export async function verifyInstallBundleHashes(
  bundle: InstallBundle,
  fetchedFiles: readonly FetchedInstallFile[]
): Promise<VerifyResult> {
  const fetchedByPath = new Map<string, Uint8Array>()
  const duplicatePaths = new Set<string>()

  for (const file of fetchedFiles) {
    const bytes = bytesFromFetchedFile(file.bytes)
    if (fetchedByPath.has(file.path)) duplicatePaths.add(file.path)
    fetchedByPath.set(file.path, bytes)
  }

  const issues: VerifyIssue[] = [...duplicatePaths].sort().map((path) => ({
    path,
    code: 'duplicate' as const,
  }))

  let checked = 0
  for (const expected of bundle.file_list) {
    const bytes = fetchedByPath.get(expected.path)
    if (!bytes) {
      issues.push({ path: expected.path, code: 'missing' })
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
        code: 'sha256_mismatch',
        expected: expected.sha256,
        actual: actualSha256,
      })
    }
  }

  return issues.length ? { ok: false, checked, issues } : { ok: true, checked, issues: [] }
}

export function isResolvable(listing: Pick<MarketplaceListing, 'installability'>): boolean {
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

export const PluginManifestSchema = z.object({
  $schema: z.string().trim().min(1).optional(),
  kind: z.literal('agentrig:plugin').optional(),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
  version: z.string().trim().min(1),
  author: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  pluginDependencies: z.array(z.string()).optional(),
  configSchema: z.record(z.string(), z.custom<{}>()).optional(),
  'x-agentrig': z.record(z.string(), z.custom<{}>()).optional(),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

export type RegistryFileDigest = {
  path: string
  digest: string
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
}

export function pluginFilesFromLock(lock: RegistryLock): RegistryDisplayFile[] {
  return lock.file_digests.map((entry) => ({
    path: entry.path,
    sha256: entry.digest,
  }))
}

function bytesFromFetchedFile(value: FetchedInstallFile['bytes']) {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
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
