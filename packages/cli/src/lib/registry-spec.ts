const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const ALIASED_PACK_PATTERN = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/

export type ParsedRegistryPackSpec = {
  registry: string | null
  pack: string
}

export function isValidRegistryAlias(name: string): boolean {
  return NAME_PATTERN.test(name)
}

export function isValidPackName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

export function isAliasedPackSpec(spec: string): boolean {
  return ALIASED_PACK_PATTERN.test(spec)
}

export function parseRegistryPackSpec(spec: string): ParsedRegistryPackSpec {
  const match = spec.match(ALIASED_PACK_PATTERN)
  if (match) {
    return {
      registry: match[1],
      pack: match[2],
    }
  }

  if (spec.includes('/')) {
    throw new Error(
      `Invalid pack spec: ${spec}\n` +
        'Use <pack-name> for official packs or <registry-alias>/<pack-name> for configured registries.'
    )
  }

  return {
    registry: null,
    pack: spec,
  }
}
