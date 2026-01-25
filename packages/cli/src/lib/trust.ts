/**
 * Trust tier management for registry sources.
 *
 * Trust tiers:
 * - official: The official agentrig.ai registry (implicit trust)
 * - listed: Registries in the directory index (verified community registries)
 * - unlisted: Direct URLs or unverified registries (requires confirmation)
 */

import type { TrustTier, DirectoryEntry } from './types'
import { OFFICIAL_REGISTRY_URL, DIRECTORY_INDEX_URL, fetchDirectoryIndex, isUrl } from './registry'
import { isNamespacedPack, parseRegistryAndItemFromString } from './namespace'

/**
 * Allowed target path prefixes for file installation.
 * Files can only be installed to these directories for security.
 */
export const ALLOWED_TARGET_PREFIXES = [
  '.codex/',
  '.claude/',
  '.cursor/',
  '.agentrig/',
  'scripts/',
  'tools/',
]

/**
 * Determine the trust tier for a pack source.
 */
let cachedDirectoryPromise: Promise<DirectoryEntry[]> | null = null

async function getDirectoryIndex(url: string = DIRECTORY_INDEX_URL): Promise<DirectoryEntry[]> {
  if (url === DIRECTORY_INDEX_URL) {
    cachedDirectoryPromise ??= fetchDirectoryIndex(url)
    return cachedDirectoryPromise
  }
  return fetchDirectoryIndex(url)
}

export async function determineTrustTier(
  source: string,
  namespacedRegistries?: Record<string, unknown>,
  directoryUrl: string = DIRECTORY_INDEX_URL
): Promise<TrustTier> {
  // Official registry
  if (source.startsWith(OFFICIAL_REGISTRY_URL)) {
    return 'official'
  }

  // Namespaced pack from configured registries
  if (isNamespacedPack(source) && namespacedRegistries) {
    const { registry } = parseRegistryAndItemFromString(source)
    if (registry && registry in namespacedRegistries) {
      try {
        const directory = await getDirectoryIndex(directoryUrl)
        const entry = directory.find((e) => e.name === registry)
        return entry?.verified ? 'listed' : 'unlisted'
      } catch {
        return 'unlisted'
      }
    }
  }

  // Check if the URL matches any listed registry in the directory
  if (isUrl(source)) {
    try {
      const directory = await getDirectoryIndex(directoryUrl)
      for (const entry of directory) {
        // Extract base URL from the template
        const baseUrl = entry.url.replace(/\{name\}.*$/, '')
        if (source.startsWith(baseUrl)) {
          return entry?.verified ? 'listed' : 'unlisted'
        }
      }
    } catch {
      return 'unlisted'
    }
  }

  return 'unlisted'
}

/**
 * Check if a target path is allowed for installation.
 */
export function isAllowedTargetPath(targetPath: string): boolean {
  const normalized = targetPath.startsWith('/') ? targetPath.slice(1) : targetPath

  return ALLOWED_TARGET_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

/**
 * Validate all target paths in a pack are allowed.
 * Returns list of disallowed paths if any.
 */
export function validateTargetPaths(
  files: Array<{ target: string }>
): { valid: boolean; disallowed: string[] } {
  const disallowed: string[] = []

  for (const file of files) {
    // Resolve placeholders for validation
    const resolved = file.target
      .replace(/\{\{skillsDir\}\}/g, '.codex/skills')
      .replace(/\{\{[^}]+\}\}/g, '') // Remove other placeholders for validation

    if (!isAllowedTargetPath(resolved)) {
      disallowed.push(file.target)
    }
  }

  return {
    valid: disallowed.length === 0,
    disallowed,
  }
}

/**
 * Get a human-readable description of a trust tier.
 */
export function describeTrustTier(tier: TrustTier): string {
  switch (tier) {
    case 'official':
      return 'Official agentrig.ai registry'
    case 'listed':
      return 'Community registry (listed in directory)'
    case 'unlisted':
      return 'Unlisted source (requires confirmation)'
  }
}

/**
 * Check if a trust tier requires user confirmation before install.
 */
export function requiresConfirmation(tier: TrustTier): boolean {
  return tier === 'unlisted'
}

/**
 * Format an install plan for display to the user.
 */
export function formatInstallPlan(
  packName: string,
  files: Array<{ path: string; target: string }>,
  trustTier: TrustTier
): string {
  const lines: string[] = [
    `Pack: ${packName}`,
    `Trust: ${describeTrustTier(trustTier)}`,
    '',
    'Files to install:',
  ]

  for (const file of files) {
    lines.push(`  ${file.path} -> ${file.target}`)
  }

  return lines.join('\n')
}
