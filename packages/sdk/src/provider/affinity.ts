import type { ProviderAffinity, ProviderCompat, ProviderCompatState, ProviderId, SignalKind } from '../repo-scan/types'
import { normalizeVirtualPath } from '../repo-scan/virtual-tree'

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'cursor']

export function providerCompatForSignal(kind: SignalKind, sourcePath: string): ProviderCompat {
  const normalizedPath = normalizeVirtualPath(sourcePath)
  const compat = signalCompat(kind, normalizedPath)
  return Object.fromEntries(
    PROVIDERS.map((provider) => [provider, compat[provider] ?? 'unsupported'])
  ) as ProviderCompat
}

export function providerAffinityForSignal(kind: SignalKind, sourcePath: string): ProviderAffinity {
  const compat = providerCompatForSignal(kind, sourcePath)
  return Object.fromEntries(
    PROVIDERS.map((provider) => {
      const state = compat[provider]
      return [provider, state === 'native' ? 1 : state === 'port' ? 0.5 : 0]
    })
  ) as ProviderAffinity
}

function signalCompat(kind: SignalKind, sourcePath: string): Partial<Record<ProviderId, ProviderCompatState>> {
  if (kind === 'codex-app') return { codex: 'native' }
  if (kind === 'lsp') return { claude: 'native' }
  if (kind === 'rule') return { cursor: 'native' }
  if (kind === 'hook') return { claude: 'native', cursor: 'native' }
  if (kind === 'mcp') return { claude: 'native', codex: 'native', cursor: 'native' }
  if (kind === 'skill') return { claude: 'native', codex: 'native', cursor: 'native' }
  if (kind === 'agent') return { claude: 'native', cursor: 'native' }
  if (kind === 'command') {
    if (hasPathPrefix(sourcePath, '.claude/commands') || hasPathSegmentPrefix(sourcePath, '.claude/commands')) {
      return { claude: 'native', codex: 'port', cursor: 'port' }
    }
    if (hasPathPrefix(sourcePath, '.codex/prompts') || hasPathSegmentPrefix(sourcePath, '.codex/prompts')) {
      return { codex: 'native', claude: 'port', cursor: 'port' }
    }
    if (hasPathPrefix(sourcePath, '.cursor/commands') || hasPathSegmentPrefix(sourcePath, '.cursor/commands')) {
      return { cursor: 'native', claude: 'port', codex: 'port' }
    }
    return { claude: 'port', cursor: 'port', codex: 'port' }
  }
  if (kind === 'settings') return { claude: 'native', cursor: 'native' }
  if (kind === 'asset' || kind === 'doc' || kind === 'script' || kind === 'prompt') {
    return { claude: 'port', codex: 'port', cursor: 'port' }
  }
  return {}
}

function hasPathPrefix(path: string, prefix: string) {
  const normalizedPrefix = normalizeVirtualPath(prefix)
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`)
}

function hasPathSegmentPrefix(path: string, prefix: string) {
  const normalizedPrefix = normalizeVirtualPath(prefix)
  return path.includes(`/${normalizedPrefix}/`)
}
