import path from 'node:path'
import type { TrustTier, RegistryRef } from './types'
import { OFFICIAL_REGISTRY_URL, normalizeRegistryUrl, isUrl } from './registry'

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

export function validatePluginPaths(
  files: Array<{ path: string }>
): { valid: boolean; disallowed: string[] } {
  const disallowed: string[] = []

  for (const file of files) {
    const normalized = normalizeRelativeTargetPath(file.path)
    if (!normalized) {
      disallowed.push(file.path)
    }
  }

  return {
    valid: disallowed.length === 0,
    disallowed,
  }
}

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

export function requiresConfirmation(tier: TrustTier): boolean {
  return tier === 'unlisted'
}

export function formatInstallPlan(
  pluginId: string,
  files: Array<{ path: string }>,
  trustTier: TrustTier
): string {
  const lines: string[] = [
    `Plugin: ${pluginId}`,
    `Trust: ${describeTrustTier(trustTier)}`,
    '',
    'Files in plugin:',
  ]

  for (const file of files) {
    lines.push(`  ${file.path}`)
  }

  return lines.join('\n')
}
