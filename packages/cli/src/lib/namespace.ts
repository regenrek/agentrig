/**
 * Namespace parsing utilities for @namespace/pack syntax.
 * Based on shadcn-ui registry parser pattern.
 */

/**
 * Valid registry namespace pattern:
 * - Must start with @
 * - Followed by alphanumeric, hyphens, or underscores
 * - Cannot end with hyphen or underscore
 */
const REGISTRY_PATTERN = /^(@[a-zA-Z0-9](?:[a-zA-Z0-9-_]*[a-zA-Z0-9])?)\/(.+)$/

/**
 * Valid pack name pattern (matches schema).
 */
const PACK_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export type ParsedRegistryItem = {
  registry: string | null
  item: string
}

/**
 * Parse a pack name that may include a namespace prefix.
 *
 * Examples:
 * - "core-committer" -> { registry: null, item: "core-committer" }
 * - "@acme/tauri-rust" -> { registry: "@acme", item: "tauri-rust" }
 * - "https://..." -> { registry: null, item: "https://..." }
 */
export function parseRegistryAndItemFromString(name: string): ParsedRegistryItem {
  if (!name.startsWith('@')) {
    return {
      registry: null,
      item: name,
    }
  }

  const match = name.match(REGISTRY_PATTERN)
  if (match) {
    return {
      registry: match[1],
      item: match[2],
    }
  }

  // Starts with @ but doesn't match pattern (could be just "@namespace" without item)
  return {
    registry: null,
    item: name,
  }
}

/**
 * Check if a string is a valid namespace (starts with @).
 */
export function isNamespace(name: string): boolean {
  return name.startsWith('@')
}

/**
 * Check if a string is a namespaced pack reference (e.g., "@acme/pack").
 */
export function isNamespacedPack(name: string): boolean {
  return REGISTRY_PATTERN.test(name)
}

/**
 * Check if a pack name is valid (no slashes, no traversal, no query).
 */
export function isValidPackName(name: string): boolean {
  return PACK_NAME_PATTERN.test(name)
}

/**
 * Build a URL from a registry URL template and pack name.
 * The template should contain {name} placeholder.
 *
 * @param urlTemplate - URL template like "https://example.com/{name}.json"
 * @param packName - Pack name to substitute
 * @returns Resolved URL
 */
export function buildRegistryUrl(urlTemplate: string, packName: string): string {
  if (!urlTemplate.includes('{name}')) {
    throw new Error(`Registry URL template must include {name} placeholder: ${urlTemplate}`)
  }
  return urlTemplate.replace('{name}', packName)
}

/**
 * Expand environment variables in a string.
 * Supports ${VAR_NAME} syntax.
 */
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    const envValue = process.env[varName]
    if (envValue === undefined) {
      throw new Error(`Environment variable ${varName} is not set`)
    }
    return envValue
  })
}

/**
 * Extract environment variable names from a string.
 */
export function extractEnvVars(value: string): string[] {
  const matches = value.matchAll(/\$\{([^}]+)\}/g)
  return Array.from(matches, (m) => m[1])
}
