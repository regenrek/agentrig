import { isPublishableSignalKind, type SignalKind } from '../repo-scan/types'

export const ARTIFACT_KINDS = ['plugin', 'skill', 'mcp', 'hook', 'command', 'agent'] as const
export const SELECTABLE_ARTIFACT_KINDS = ['skill', 'mcp', 'hook', 'command', 'agent'] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]
export type SelectableArtifactKind = (typeof SELECTABLE_ARTIFACT_KINDS)[number]

export type ArtifactSelector = {
  kind: SelectableArtifactKind
  name: string
  selector: string
}

const ARTIFACT_NAME_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value)
}

export function isSelectableArtifactKind(value: string): value is SelectableArtifactKind {
  return (SELECTABLE_ARTIFACT_KINDS as readonly string[]).includes(value)
}

export function artifactKindFromSignalKind(kind: SignalKind): SelectableArtifactKind | null {
  if (!isPublishableSignalKind(kind)) return null
  if (kind === 'skill' || kind === 'mcp' || kind === 'hook' || kind === 'agent') return kind
  if (kind === 'command' || kind === 'prompt') return 'command'
  return null
}

export function normalizeArtifactName(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!ARTIFACT_NAME_RE.test(normalized)) {
    throw new Error(`Invalid artifact name: ${value}`)
  }
  return normalized
}

export function formatArtifactSelector(kind: SelectableArtifactKind, name: string): string {
  return `${kind}:${normalizeArtifactName(name)}`
}

export function parseArtifactSelector(input: string, defaultKind?: SelectableArtifactKind): ArtifactSelector {
  const trimmed = input.trim()
  const separatorIndex = trimmed.indexOf(':')
  if (separatorIndex === -1) {
    if (!defaultKind) {
      throw new Error(`Artifact selector must include a kind prefix: ${input}`)
    }
    const name = normalizeArtifactName(trimmed)
    return { kind: defaultKind, name, selector: formatArtifactSelector(defaultKind, name) }
  }

  const kind = trimmed.slice(0, separatorIndex)
  if (!isSelectableArtifactKind(kind)) {
    throw new Error(`Unsupported artifact selector kind: ${kind}`)
  }
  const name = normalizeArtifactName(trimmed.slice(separatorIndex + 1))
  return { kind, name, selector: formatArtifactSelector(kind, name) }
}

export function uniqueArtifactSelectors(selectors: readonly string[]): string[] {
  return [...new Set(selectors.map((selector) => parseArtifactSelector(selector).selector))].sort()
}
