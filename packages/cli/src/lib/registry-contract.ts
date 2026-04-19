export const REGISTRY_TRUST_TIERS = [
  "official",
  "reviewed",
  "listed",
  "blocked",
  "yanked",
] as const

export type CanonicalTrustTier = (typeof REGISTRY_TRUST_TIERS)[number]

export const INSTALLABILITY_STATES = [
  "installable",
  "discovery_only",
  "blocked",
  "yanked",
] as const

export type InstallabilityState = (typeof INSTALLABILITY_STATES)[number]

export type CanonicalSubmissionSource = {
  upstream_repo: string
  upstream_tag: string
  upstream_commit_sha: string
  plugin_path: string
}

export type CanonicalRegistryVersionArtifacts = {
  manifest: ".plugin/plugin.json"
  source: "AGENTRIG_SOURCE.json"
  lock: "AGENTRIG_LOCK.json"
  review: "AGENTRIG_REVIEW.json"
}

export const CANONICAL_VERSION_ARTIFACTS: CanonicalRegistryVersionArtifacts = {
  manifest: ".plugin/plugin.json",
  source: "AGENTRIG_SOURCE.json",
  lock: "AGENTRIG_LOCK.json",
  review: "AGENTRIG_REVIEW.json",
}

export function isCanonicalPluginId(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
}

export function isCanonicalInstallRef(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    value
  )
}
