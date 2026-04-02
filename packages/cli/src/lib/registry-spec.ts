const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const ALIASED_PLUGIN_PATTERN = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/

export type ParsedRegistryPluginSpec = {
  registry: string | null
  plugin: string
}

export function isValidRegistryAlias(name: string): boolean {
  return NAME_PATTERN.test(name)
}

export function isValidPluginId(name: string): boolean {
  return NAME_PATTERN.test(name)
}

export function isAliasedPluginSpec(spec: string): boolean {
  return ALIASED_PLUGIN_PATTERN.test(spec)
}

export function parseRegistryPluginSpec(spec: string): ParsedRegistryPluginSpec {
  const match = spec.match(ALIASED_PLUGIN_PATTERN)
  if (match) {
    return {
      registry: match[1],
      plugin: match[2],
    }
  }

  if (spec.includes('/')) {
    throw new Error(
      `Invalid plugin spec: ${spec}\n` +
        'Use <plugin-id> for official plugins or <registry-alias>/<plugin-id> for configured registries.'
    )
  }

  return {
    registry: null,
    plugin: spec,
  }
}
