export type AgentrigUseProvider = 'claude' | 'codex' | 'cursor' | 'all'

export type AgentrigUseMode =
  | { kind: 'install' }
  | { kind: 'as-plugin'; pluginId: string }

export type BuildAgentrigUseCommandInput = {
  repoFullName: string
  commitSha?: string
  ref?: string
  subdir?: string
  picks: string[]
  provider?: AgentrigUseProvider
  mode?: AgentrigUseMode
}

const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_SHA_RE = /^[a-f0-9]{7,40}$/i
const REF_RE = /^[A-Za-z0-9_./-]{1,200}$/
const SUBDIR_RE = /^[A-Za-z0-9_./-]{1,200}$/
const PICK_RE = /^[A-Za-z0-9_./@-][A-Za-z0-9_./@ -]{0,300}$/
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/
const PROVIDERS = new Set<AgentrigUseProvider>(['claude', 'codex', 'cursor', 'all'])

/**
 * Builds a shell-safe `agentrig use ...` command for installing or
 * materializing picked signals from an external GitHub repo.
 *
 * Inputs are validated to keep operators in a strict allow-list. When a commit
 * SHA is available it is emitted as --ref so copied commands stay pinned.
 */
export function buildAgentrigUseCommand(input: BuildAgentrigUseCommandInput): string {
  const repoFullName = input.repoFullName.trim()
  if (!REPO_FULL_NAME_RE.test(repoFullName)) {
    throw new Error(`Invalid repoFullName: ${input.repoFullName}`)
  }

  const picks = (input.picks ?? [])
    .map((pick) => pick.trim())
    .filter(Boolean)
  if (!picks.length) throw new Error('buildAgentrigUseCommand requires at least one pick')
  for (const pick of picks) {
    if (pick.startsWith('-')) throw new Error(`Invalid pick (starts with '-'): ${pick}`)
    if (!PICK_RE.test(pick)) throw new Error(`Invalid pick: ${pick}`)
  }

  const provider: AgentrigUseProvider = input.provider ?? 'all'
  if (!PROVIDERS.has(provider)) throw new Error(`Invalid provider: ${provider}`)

  const mode: AgentrigUseMode = input.mode ?? { kind: 'install' }
  if (mode.kind === 'as-plugin' && !PLUGIN_ID_RE.test(mode.pluginId)) {
    throw new Error(`Invalid plugin id: ${mode.pluginId}`)
  }

  const refValue = input.commitSha?.trim() || input.ref?.trim() || ''
  const parts = ['agentrig', 'use', repoFullName]
  if (refValue) {
    if (input.commitSha?.trim()) {
      if (!COMMIT_SHA_RE.test(input.commitSha.trim())) {
        throw new Error(`Invalid commitSha: ${input.commitSha}`)
      }
    } else if (!REF_RE.test(refValue)) {
      throw new Error(`Invalid ref: ${refValue}`)
    }
    parts.push('--ref', shellQuote(refValue))
  }

  const subdir = input.subdir?.trim()
  if (subdir) {
    if (!SUBDIR_RE.test(subdir)) {
      throw new Error(`Invalid subdir: ${subdir}`)
    }
    parts.push('--path', shellQuote(subdir))
  }

  parts.push('--pick', shellQuote(picks.join(',')))

  if (mode.kind === 'install') {
    parts.push('--install')
  } else {
    parts.push('--as-plugin', shellQuote(mode.pluginId))
  }

  parts.push('--provider', provider)
  return parts.join(' ')
}

/**
 * Derives a default `external.<owner>-<repo>` plugin id from a repoFullName.
 * Useful for pre-filling --as-plugin in hosted and CLI UX.
 */
export function deriveExternalPluginId(repoFullName: string) {
  const trimmed = repoFullName.trim()
  if (!REPO_FULL_NAME_RE.test(trimmed)) {
    throw new Error(`Invalid repoFullName: ${repoFullName}`)
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `external.${slug}` as const
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./@-][A-Za-z0-9_./@,-]*$/.test(value)) return value
  if (value.includes("'")) {
    throw new Error(`Refusing to quote value with single quote: ${value}`)
  }
  return `'${value}'`
}
