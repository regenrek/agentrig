/**
 * Trust tier management for registry sources.
 *
 * Trust tiers:
 * - official: The official agentrig.ai registry (implicit trust)
 * - listed: A registry the user explicitly configured in AgentRig
 * - unlisted: Direct URLs or unknown sources (requires confirmation)
 */

import path from 'node:path'
import type { TrustTier, RegistryRef } from './types'
import { OFFICIAL_REGISTRY_URL, normalizeRegistryUrl, isUrl } from './registry'

/**
 * Allowed target path prefixes for file installation.
 * Files can only be installed to these directories for security.
 */
export const ALLOWED_TARGET_PREFIXES = [
  '.codex/',
  '.claude/',
  '.cursor/',
  '.agentrig/',
]

export async function determineTrustTier(
  source: string,
  registries: RegistryRef[] = []
): Promise<TrustTier> {
  const normalizedOfficial = normalizeRegistryUrl(OFFICIAL_REGISTRY_URL)
  const normalizedSource = normalizeRegistryUrl(source)

  if (normalizedSource === normalizedOfficial || normalizedSource.startsWith(`${normalizedOfficial}/`)) {
    return 'official'
  }

  if (isUrl(source)) {
    for (const registry of registries) {
      const normalizedRegistry = normalizeRegistryUrl(registry.url)
      if (
        normalizedSource === normalizedRegistry ||
        normalizedSource.startsWith(`${normalizedRegistry}/`)
      ) {
        return registry.url === OFFICIAL_REGISTRY_URL ? 'official' : 'listed'
      }
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

function normalizeRelativeTargetPath(targetPath: string): string | null {
  if (!targetPath || targetPath.startsWith('/') || targetPath.startsWith('\\')) {
    return null
  }

  const slashNormalized = targetPath.replace(/\\/g, '/')
  if (slashNormalized.split('/').some((segment) => segment === '..')) {
    return null
  }

  const normalized = path.posix.normalize(slashNormalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null
  }

  return normalized
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

    const normalized = normalizeRelativeTargetPath(resolved)
    if (!normalized || !isAllowedTargetPath(normalized)) {
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
      return 'Configured registry'
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
