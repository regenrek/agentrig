import type { RepoScanReport, Signal } from './types'

export async function digestSignals(signals: readonly Signal[]) {
  return sha256Hex(canonicalJson(signals.map(normalizeSignalForDigest)))
}

export async function digestRepoScanReport(report: Pick<RepoScanReport, 'signals'>) {
  return digestSignals(report.signals)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value))
}

function normalizeSignalForDigest(signal: Signal) {
  return {
    kind: signal.kind,
    id: signal.id,
    title: signal.title,
    ...(signal.description ? { description: signal.description } : {}),
    sourcePath: signal.sourcePath,
    files: signal.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
    providerAffinity: signal.providerAffinity,
    providerCompat: signal.providerCompat,
    score: signal.score,
    ...(signal.notes?.length ? { notes: signal.notes } : {}),
  }
}

function toCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCanonicalValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, toCanonicalValue(child)])
  )
}

async function sha256Hex(value: string) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 digest requires Web Crypto support')
  }
  const bytes = new TextEncoder().encode(value)
  const digest = await subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
