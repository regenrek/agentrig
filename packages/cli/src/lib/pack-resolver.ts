import { resolvePackByName, resolvePackFromMetaSpec, resolvePackFromRegistryAlias, isFileish, isUrl } from './registry'
import { parseRegistryPackSpec } from './registry-spec'
import type { ResolvedPack } from './registry'
import type { RegistryRef } from './types'

export async function resolvePackSpec(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
): Promise<ResolvedPack> {
  if (isUrl(spec) || isFileish(spec)) {
    return resolvePackFromMetaSpec(spec, cwd)
  }

  const parsedSpec = parseRegistryPackSpec(spec)
  return parsedSpec.registry
    ? resolvePackFromRegistryAlias(parsedSpec.registry, parsedSpec.pack, registries)
    : resolvePackByName(parsedSpec.pack, registries)
}
