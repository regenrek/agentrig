export const SIGNAL_KINDS = [
  'skill',
  'command',
  'prompt',
  'agent',
  'rule',
  'hook',
  'mcp',
  'lsp',
  'codex-app',
  'settings',
  'script',
  'asset',
  'doc',
] as const

export const PROVIDER_IDS = ['claude', 'codex', 'cursor'] as const

export const PROVIDER_COMPAT_STATES = ['native', 'port', 'unsupported'] as const

export type SignalKind = (typeof SIGNAL_KINDS)[number]
export type ProviderId = (typeof PROVIDER_IDS)[number]
export type ProviderCompatState = (typeof PROVIDER_COMPAT_STATES)[number]

export type ProviderAffinity = Record<ProviderId, number>
export type ProviderCompat = Record<ProviderId, ProviderCompatState>

export type SignalFile = {
  path: string
  sha256: string
  bytes: number
}

export type Signal = {
  kind: SignalKind
  id: string
  title: string
  description?: string
  sourcePath: string
  files: SignalFile[]
  providerAffinity: ProviderAffinity
  providerCompat: ProviderCompat
  score: number
  notes?: string[]
}

export type RepoScanSource = {
  type: 'local' | 'github' | 'archive' | 'virtual'
  label: string
  ref?: string
  commitSha?: string
  subdir?: string
}

export type RepoScanPluginCandidateFile = {
  path: string
  digest: string
  bytes?: number
}

export type RepoScanPluginCandidate = {
  artifactId: string
  version?: string
  sourcePath: string
  manifestPath: string
  files: RepoScanPluginCandidateFile[]
}

export type RepoScanReport = {
  source: RepoScanSource
  signals: Signal[]
  pluginCandidates: RepoScanPluginCandidate[]
  digest: string
}
