import {
  resolvePluginById,
  resolvePluginFromManifestSpec,
  resolvePluginFromRegistryAlias,
  isFileish,
  isUrl,
} from './registry'
import { parseRegistryPluginSpec } from './registry-spec'
import type { ResolvedPlugin } from './registry'
import type { RegistryRef } from './types'

export async function resolvePluginSpec(
  spec: string,
  cwd: string,
  registries: RegistryRef[]
): Promise<ResolvedPlugin> {
  if (isUrl(spec) || isFileish(spec)) {
    return resolvePluginFromManifestSpec(spec, cwd)
  }

  const parsedSpec = parseRegistryPluginSpec(spec)
  return parsedSpec.registry
    ? resolvePluginFromRegistryAlias(parsedSpec.registry, parsedSpec.plugin, registries)
    : resolvePluginById(parsedSpec.plugin, registries)
}
