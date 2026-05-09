const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PLUGIN_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const LISTING_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const INSTALL_REF_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?:@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/
const REGISTRY_ARTIFACT_KINDS = ['skill', 'mcp', 'hook'] as const

export type ParsedRegistryArtifactKind = typeof REGISTRY_ARTIFACT_KINDS[number]

export type ParsedRegistryPluginSpec = {
  registry: string
  plugin: string
  version?: string
}

export type ParsedRegistryArtifactSpec = {
  registry: string
  artifactKind: ParsedRegistryArtifactKind
  artifact: string
  version?: string
}

export function isValidRegistryAlias(name: string): boolean {
  return NAME_PATTERN.test(name)
}

export function isValidPluginId(name: string): boolean {
  return PLUGIN_ID_PATTERN.test(name)
}

export function isValidListingId(name: string): boolean {
  return LISTING_ID_PATTERN.test(name)
}

export function isValidExactPluginVersion(version: string): boolean {
  return SEMVER_PATTERN.test(version)
}

export function isValidRegistryArtifactKind(kind: string): kind is ParsedRegistryArtifactKind {
  return (REGISTRY_ARTIFACT_KINDS as readonly string[]).includes(kind)
}

export function parseRegistryPluginSpec(spec: string): ParsedRegistryPluginSpec {
  const trimmed = spec.trim()
  const match = trimmed.match(INSTALL_REF_PATTERN)
  if (!match) {
    throw new Error(
      `Invalid install ref: ${spec}\n` +
        'Use the canonical public install form: <marketplaceAlias>/<listing-slug>. Add @<version> only for an explicit pin.'
    )
  }

  return {
    registry: match[1],
    plugin: match[2],
    version: match[3],
  }
}

export function parseRegistryArtifactSpec(
  spec: string,
  artifactKind: ParsedRegistryArtifactKind
): ParsedRegistryArtifactSpec {
  const trimmed = spec.trim()
  const match = trimmed.match(INSTALL_REF_PATTERN)
  if (!match) {
    throw new Error(
      `Invalid ${artifactKind} install ref: ${spec}\n` +
        `Use the canonical public standalone ${artifactKind} install form: <marketplaceAlias>/<listing-slug>. Add @<version> only for an explicit pin.`
    )
  }

  return {
    registry: match[1],
    artifactKind,
    artifact: match[2],
    version: match[3],
  }
}
