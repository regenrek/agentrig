import {
  resolvePluginFromRegistryAlias,
} from './registry'
import { parseRegistryPluginSpec } from './registry-spec'
import type { ResolvedPlugin } from './registry'
import type { RegistryRef } from './types'

export async function resolvePluginSpec(
  spec: string,
  _cwd: string,
  registries: RegistryRef[]
): Promise<ResolvedPlugin> {
  const parsedSpec = parseRegistryPluginSpec(spec)
  return resolvePluginFromRegistryAlias(
    parsedSpec.registry,
    parsedSpec.plugin,
    parsedSpec.version,
    registries
  )
}
