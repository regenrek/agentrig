export type ProviderPluginNameTarget = 'codex' | 'cursor' | 'claude'

const FALLBACK_PROVIDER_PLUGIN_NAME = 'plugin'
const OPEN_PLUGIN_NAME_RE = /^(?!.*(?:--|\.{2}))(?=.{1,64}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export function isValidPluginName(name: string) {
  return OPEN_PLUGIN_NAME_RE.test(name)
}

/**
 * Returns a provider-safe sanitized identifier for path/cache keys in
 * downstream tools. Must NEVER be written back into manifest.name or persisted
 * as canonical identity. Use only at provider boundaries.
 */
export function sanitizeProviderPluginName(
  name: string,
  _target: ProviderPluginNameTarget
) {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  const named = sanitized || FALLBACK_PROVIDER_PLUGIN_NAME
  return /^[a-z]/.test(named) ? named : `${FALLBACK_PROVIDER_PLUGIN_NAME}-${named}`
}

export function formatProviderPluginName(
  pluginPrefix: string,
  manifestName: string,
  target: ProviderPluginNameTarget
) {
  return `${pluginPrefix}${sanitizeProviderPluginName(manifestName, target)}`
}
