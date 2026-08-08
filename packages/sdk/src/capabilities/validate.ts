import { agentRigPluginExtension, type PluginManifest } from '../agent-plugins'

export type CapabilityProviderVerificationStatus =
  | {
      stale: false
      lastVerified: string
      cadence: string
      staleAt: string
    }
  | {
      stale: true
      lastVerified?: string
      cadence?: string
      staleAt?: string
      reason: string
    }

const DAY_MS = 24 * 60 * 60 * 1000

export function evaluateCapabilityProviderVerification(
  manifest: Pick<PluginManifest, 'extensions'>,
  now: Date
): CapabilityProviderVerificationStatus {
  const verification = agentRigPluginExtension(manifest)?.verification
  if (!verification) {
    return { stale: true, reason: 'Provider is missing extensions["ai.agentrig"].verification metadata.' }
  }

  const lastVerified = parseUtcDateOnly(verification.lastVerified)
  if (!lastVerified) {
    return {
      stale: true,
      lastVerified: verification.lastVerified,
      cadence: verification.cadence,
      reason: 'Provider verification lastVerified is not a valid YYYY-MM-DD date.',
    }
  }

  const cadenceMs = parseVerificationCadenceMs(verification.cadence)
  if (!cadenceMs) {
    return {
      stale: true,
      lastVerified: verification.lastVerified,
      cadence: verification.cadence,
      reason: `Provider verification cadence "${verification.cadence}" is not supported.`,
    }
  }

  const staleAt = new Date(lastVerified.getTime() + cadenceMs)
  if (now.getTime() > staleAt.getTime()) {
    return {
      stale: true,
      lastVerified: verification.lastVerified,
      cadence: verification.cadence,
      staleAt: staleAt.toISOString(),
      reason: `Provider verification is stale; ${verification.cadence} window ended at ${staleAt.toISOString()}.`,
    }
  }

  return {
    stale: false,
    lastVerified: verification.lastVerified,
    cadence: verification.cadence,
    staleAt: staleAt.toISOString(),
  }
}

export function parseVerificationCadenceMs(cadence: string): number | undefined {
  const match = cadence.trim().toLowerCase().match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/)
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isInteger(amount) || amount <= 0) return undefined

  const unit = match[2]
  if (unit === 'd' || unit === 'day' || unit === 'days') return amount * DAY_MS
  if (unit === 'w' || unit === 'week' || unit === 'weeks') return amount * 7 * DAY_MS
  return amount * 30 * DAY_MS
}

function parseUtcDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return undefined
  }

  return parsed
}
