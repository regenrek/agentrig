const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PLUGIN_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const INSTALL_REF_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

export type ParsedRegistryPluginSpec = {
  registry: string
  plugin: string
  version: string
}

export function isValidRegistryAlias(name: string): boolean {
  return NAME_PATTERN.test(name)
}

export function isValidPluginId(name: string): boolean {
  return PLUGIN_ID_PATTERN.test(name)
}

export function isValidExactPluginVersion(version: string): boolean {
  return SEMVER_PATTERN.test(version)
}

export function parseRegistryPluginSpec(spec: string): ParsedRegistryPluginSpec {
  const trimmed = spec.trim()
  const match = trimmed.match(INSTALL_REF_PATTERN)
  if (!match) {
    throw new Error(
      `Invalid install ref: ${spec}\n` +
        'Use the canonical public install form: <registryAlias>/<namespace.plugin>@<version>.'
    )
  }

  return {
    registry: match[1],
    plugin: match[2],
    version: match[3],
  }
}
