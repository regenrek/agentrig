import { spawnSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_SHORTHAND_RE = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@(.+))?$/

export type SubmitSourcePayload = {
  upstream_repo: string
  upstream_tag: string
  upstream_commit_sha: string
  plugin_path: string
}

export type ResolveSubmitSourceOptions = {
  source: string
  workdir?: string
  version?: string
  path?: string
  expectedCommitSha?: string
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
}

type GitHubSource = {
  owner: string
  repo: string
  url: string
  ref?: string
  repoPath: string
}

export async function resolveSubmitSource(options: ResolveSubmitSourceOptions): Promise<SubmitSourcePayload> {
  const source = options.source.trim()
  if (!source) throw new Error('Submit source is required.')

  const workdir = options.workdir ?? process.cwd()
  const localPath = await resolveLocalSource(source, workdir)
  if (localPath) {
    return resolveLocalSubmitSource(localPath, options)
  }

  const githubSource = parseGitHubSource(source)
  if (!githubSource) {
    throw new Error('Unsupported submit source. Use a local path, GitHub owner/repo[@tag], github:owner/repo[@tag], or https://github.com/owner/repo.')
  }
  return resolveGitHubSubmitSource(githubSource, options)
}

export function normalizeGitHubRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/')
  if (!trimmed) return undefined

  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed)
  if (shorthand) return `${shorthand[1]}/${stripGitSuffix(shorthand[2])}`

  try {
    const url = new URL(trimmed)
    if (!GITHUB_HOSTS.has(url.hostname)) return undefined
    const segments = decodePathSegments(url.pathname)
    const owner = segments[0]
    const repo = segments[1] ? stripGitSuffix(segments[1]) : undefined
    if (!owner || !repo) return undefined
    return `${owner}/${repo}`
  } catch {
    return undefined
  }
}

async function resolveLocalSubmitSource(localPath: string, options: ResolveSubmitSourceOptions): Promise<SubmitSourcePayload> {
  const gitInfo = resolveLocalGitInfo(localPath)
  if (!gitInfo.repo) {
    throw new Error('Local submit source must be inside a GitHub-backed git repository.')
  }
  if (!gitInfo.commit) {
    throw new Error('Local submit source must have a resolvable git commit.')
  }
  assertExpectedCommit(gitInfo.commit, options.expectedCommitSha)

  const tag = options.version
    ? resolveLocalVersionTag(gitInfo.root, options.version, gitInfo.commit)
    : gitInfo.exactTag
  if (!tag) {
    throw new Error('Local submit source must be checked out at a tag or pass --version for a tag that points at HEAD.')
  }

  return {
    upstream_repo: `https://github.com/${gitInfo.repo}`,
    upstream_tag: tag,
    upstream_commit_sha: gitInfo.commit,
    plugin_path: normalizeRepoSubpath(options.path ?? gitInfo.path),
  }
}

async function resolveGitHubSubmitSource(source: GitHubSource, options: ResolveSubmitSourceOptions): Promise<SubmitSourcePayload> {
  const ref = await resolveGitHubSubmitRef(source, options)
  const commit = await resolveGitHubTagCommit(source, ref, options)
  assertExpectedCommit(commit, options.expectedCommitSha)
  return {
    upstream_repo: source.url,
    upstream_tag: ref,
    upstream_commit_sha: commit,
    plugin_path: normalizeRepoSubpath(options.path ?? source.repoPath),
  }
}

async function resolveGitHubSubmitRef(source: GitHubSource, options: ResolveSubmitSourceOptions) {
  if (source.ref) return source.ref
  const version = options.version?.trim()
  if (!version) {
    throw new Error('Remote submit source requires a tag. Use owner/repo@v1.2.3 or pass --version 1.2.3.')
  }
  const candidates = version.startsWith('v') ? [version, version.slice(1)] : [`v${version}`, version]
  for (const candidate of candidates) {
    const commit = await tryResolveGitHubTagCommit(source, candidate, options)
    if (commit) return candidate
  }
  throw new Error(`GitHub tag not found for version ${version}. Tried ${candidates.join(', ')}.`)
}

export function resolveLocalGitInfo(folder: string) {
  const root = runGit(folder, ['rev-parse', '--show-toplevel'])
  if (!root) return { root: folder, path: '.', repo: undefined, commit: undefined, exactTag: undefined }

  const prefix = normalizeRepoSubpath(runGit(folder, ['rev-parse', '--show-prefix']) || '.')
  const commit = runGit(folder, ['rev-parse', 'HEAD'])?.toLowerCase()
  const exactTag = runGit(folder, ['describe', '--tags', '--exact-match']) || undefined
  const repo = normalizeGitHubRepo(runGit(folder, ['remote', 'get-url', 'origin']) || '')

  return {
    root,
    path: prefix,
    repo,
    commit: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : undefined,
    exactTag,
  }
}

function resolveLocalVersionTag(root: string, version: string, expectedCommit: string) {
  const trimmed = version.trim()
  const candidates = trimmed.startsWith('v') ? [trimmed, trimmed.slice(1)] : [`v${trimmed}`, trimmed]
  for (const candidate of candidates) {
    const commit = runGit(root, ['rev-list', '-n', '1', `refs/tags/${candidate}`])?.toLowerCase()
    if (commit === expectedCommit) return candidate
  }
  return undefined
}

async function resolveLocalSource(source: string, workdir: string) {
  const candidate = path.resolve(workdir, fromFileUrlOrHome(source))
  if (source.startsWith('https://') || source.startsWith('github:')) return null
  if (!isLocalLike(source) && GITHUB_SHORTHAND_RE.test(source)) {
    const localStat = await stat(candidate).catch(() => null)
    return localStat?.isDirectory() ? candidate : null
  }
  const localStat = await stat(candidate).catch(() => null)
  return localStat?.isDirectory() ? candidate : null
}

function parseGitHubSource(source: string): GitHubSource | null {
  const shorthand = GITHUB_SHORTHAND_RE.exec(source.trim())
  if (shorthand) {
    const owner = shorthand[1]
    const repo = stripGitSuffix(shorthand[2])
    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
      ref: shorthand[3]?.trim() || undefined,
      repoPath: '.',
    }
  }

  let url: URL
  try {
    url = new URL(source)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !GITHUB_HOSTS.has(url.hostname)) return null
  const segments = decodePathSegments(url.pathname)
  const owner = segments[0]
  const repo = segments[1] ? stripGitSuffix(segments[1]) : undefined
  if (!owner || !repo) return null
  if (segments.length > 2) {
    throw new Error('Submit source URL must be https://github.com/<owner>/<repo>. Use owner/repo@<tag> or pass --version <tag> instead of /tree/, /blob/, or /releases/ URLs.')
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}`, repoPath: '.' }
}

async function resolveGitHubTagCommit(source: GitHubSource, ref: string, options: ResolveSubmitSourceOptions) {
  const commit = await tryResolveGitHubTagCommit(source, ref, options)
  if (!commit) throw new Error(`GitHub tag not found: ${source.owner}/${source.repo}@${ref}`)
  return commit
}

async function tryResolveGitHubTagCommit(source: GitHubSource, ref: string, options: ResolveSubmitSourceOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(githubApiUrl(`/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/ref/tags/${encodeURIComponent(ref)}`, options.env), {
    method: 'GET',
    headers: githubHeaders(options.env),
  })
  if (!response.ok) return undefined
  const payload = await response.json() as { object?: { sha?: unknown; type?: unknown } }
  return peelGitHubObjectToCommit(source, payload.object, options)
}

async function peelGitHubObjectToCommit(
  source: GitHubSource,
  object: { sha?: unknown; type?: unknown } | undefined,
  options: ResolveSubmitSourceOptions,
) {
  let current = normalizeGitHubObject(object)
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current) return undefined
    if (current.type === 'commit') return current.sha
    if (current.type !== 'tag') return undefined

    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl(githubApiUrl(`/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/tags/${encodeURIComponent(current.sha)}`, options.env), {
      method: 'GET',
      headers: githubHeaders(options.env),
    })
    if (!response.ok) return undefined
    const payload = await response.json() as { object?: { sha?: unknown; type?: unknown } }
    current = normalizeGitHubObject(payload.object)
  }
  return undefined
}

function normalizeGitHubObject(object: { sha?: unknown; type?: unknown } | undefined) {
  const sha = typeof object?.sha === 'string' ? object.sha.trim().toLowerCase() : ''
  const type = typeof object?.type === 'string' ? object.type.trim() : ''
  if (!/^[a-f0-9]{40}$/.test(sha) || !type) return undefined
  return { sha, type }
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return undefined
  return result.stdout.trim() || undefined
}

function githubApiUrl(apiPath: string, env: NodeJS.ProcessEnv = process.env) {
  return `${env.GITHUB_API_BASE_URL || 'https://api.github.com'}${apiPath}`
}

function githubHeaders(env: NodeJS.ProcessEnv = process.env) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
  const token = env.GITHUB_TOKEN || env.AGENTRIG_TEMPLATE_TOKEN
  if (token?.trim() && shouldSendGitHubToken(env)) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

function shouldSendGitHubToken(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = env.GITHUB_API_BASE_URL || 'https://api.github.com'
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' && url.hostname === 'api.github.com'
  } catch {
    return false
  }
}

function assertExpectedCommit(actual: string, expected: string | undefined) {
  const normalized = expected?.trim().toLowerCase()
  if (!normalized) return
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error('Expected commit SHA must be a full 40-character SHA.')
  if (actual !== normalized) {
    throw new Error(`Resolved submit source commit ${actual} does not match expected commit ${normalized}.`)
  }
}

function isLocalLike(source: string) {
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('~') || source.startsWith('file:')
}

function fromFileUrlOrHome(source: string) {
  if (source === '~') return os.homedir()
  if (source.startsWith('~/')) return path.join(os.homedir(), source.slice(2))
  if (source.startsWith('file:')) return fileURLToPath(source)
  return source
}

function decodePathSegments(pathname: string) {
  return pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        throw new Error('Invalid GitHub URL.')
      }
    })
}

function normalizeRepoSubpath(value: string) {
  if (path.isAbsolute(value.trim())) {
    throw new Error('Submit source path must stay inside the repository.')
  }
  const normalized = value
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
    .replace(/^\.\/+/, '')
  if (!normalized || normalized === '.') return '.'
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Submit source path must stay inside the repository.')
  }
  return segments.join('/')
}

function stripGitSuffix(value: string) {
  return value.replace(/\.git$/i, '')
}
