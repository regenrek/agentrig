export type ProviderPluginNameTarget = 'codex' | 'cursor' | 'claude'

const FALLBACK_PROVIDER_PLUGIN_NAME = 'plugin'

/**
 * Provider-facing plugin identifiers are path/cache keys in downstream tools.
 * Keep AgentRig artifact IDs canonical elsewhere and sanitize only at this edge.
 */
export function sanitizeProviderPluginName(
  artifactId: string,
  _target: ProviderPluginNameTarget
) {
  const sanitized = artifactId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  const named = sanitized || FALLBACK_PROVIDER_PLUGIN_NAME
  return /^[a-z]/.test(named) ? named : `${FALLBACK_PROVIDER_PLUGIN_NAME}-${named}`
}
