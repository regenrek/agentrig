import path from 'node:path'
import type { RegistryInstallability, TrustTier } from './types'

export const ALLOWED_TARGET_PREFIXES = [
  '.codex/',
  '.claude/',
  '.cursor/',
  '.agentrig/',
]

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
      return 'Official AgentRig registry artifact'
    case 'reviewed':
      return 'Reviewed registry artifact'
    case 'listed':
      return 'Listed registry artifact (discovery only)'
    case 'blocked':
      return 'Blocked registry artifact'
    case 'yanked':
      return 'Yanked registry artifact'
  }
}

export function assertInstallableTrust(
  pluginId: string,
  version: string,
  trustTier: TrustTier,
  installability: RegistryInstallability
) {
  if (trustTier === 'official' || trustTier === 'reviewed') {
    if (installability !== 'installable') {
      throw new Error(
        `Installability mismatch for ${pluginId}@${version}: ${trustTier} must resolve to an installable registry artifact.`
      )
    }
    return
  }

  if (trustTier === 'listed') {
    throw new Error(
      `Trust-tier rejection for ${pluginId}@${version}: listed registry artifacts are discovery-only and cannot be installed.`
    )
  }
  if (trustTier === 'blocked') {
    throw new Error(
      `Blocked install refused for ${pluginId}@${version}: the registry marks this snapshot as blocked.`
    )
  }
  throw new Error(
    `Yanked install refused for ${pluginId}@${version}: yanked snapshots are not accepted for new installs.`
  )
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
