import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { downloadTemplate } from 'giget'
import type { RepoScanSource, VirtualTree } from '@agentrig/sdk'
import { createLocalFsVirtualTree } from '@agentrig/sdk/fs-adapters/local-fs'

const GITHUB_SHORTHAND_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

export type ResolvedRepoSource = {
  root: string
  source: RepoScanSource
  tree: VirtualTree
  cleanup(): Promise<void>
}

export type ResolveRepoSourceOptions = {
  source: string
  ref?: string
  subdir?: string
  fetchImpl?: typeof fetch
  downloadTemplateImpl?: typeof downloadTemplate
}

export async function resolveRepoSource(options: ResolveRepoSourceOptions): Promise<ResolvedRepoSource> {
  const requestedSource = options.source.trim()
  if (!requestedSource) throw new Error('Source is required')

  if (isLocalSource(requestedSource)) {
    const root = path.resolve(fromFileUrl(requestedSource))
    const scanRoot = options.subdir ? path.resolve(root, options.subdir) : root
    assertPathInside(root, scanRoot)
    return {
      root: scanRoot,
      source: {
        type: 'local',
        label: root,
        ...(options.subdir ? { subdir: options.subdir } : {}),
      },
      tree: createLocalFsVirtualTree(scanRoot),
      async cleanup() {},
    }
  }

  const githubSource = parseGitHubSource(requestedSource)
  if (!githubSource) {
    throw new Error('Unsupported remote source. Use a local path, file: URL, GitHub owner/repo, github:owner/repo, or https://github.com/owner/repo.')
  }
  const explicitSubdir = normalizeSubdir(options.subdir)
  const resolvedGitHub = await resolveGitHubSource(githubSource, {
    ref: options.ref,
    subdir: explicitSubdir,
    fetchImpl: options.fetchImpl,
  })
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-inspect-'))
  const templateSpec = toGigetSource(resolvedGitHub.repoUrl, resolvedGitHub.commitSha)
  const token = process.env.GITHUB_TOKEN || process.env.AGENTRIG_TEMPLATE_TOKEN
  const download = options.downloadTemplateImpl ?? downloadTemplate
  const downloaded = await download(templateSpec, {
    dir: tempDir,
    force: true,
    auth: token?.trim() ? token.trim() : undefined,
  })
  const root = downloaded.dir
  const scanRoot = resolvedGitHub.subdir ? path.resolve(root, resolvedGitHub.subdir) : root
  assertPathInside(root, scanRoot)

  return {
    root: scanRoot,
    source: {
      type: 'github',
      label: resolvedGitHub.repoUrl,
      ref: resolvedGitHub.ref,
      commitSha: resolvedGitHub.commitSha,
      ...(resolvedGitHub.subdir ? { subdir: resolvedGitHub.subdir } : {}),
    },
    tree: createLocalFsVirtualTree(scanRoot),
    cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
  }
}

function isLocalSource(source: string) {
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('file:')
}

function fromFileUrl(source: string) {
  return source.startsWith('file:') ? fileURLToPath(source) : source
}

function toGigetSource(source: string, ref?: string) {
  const githubShorthand = toGitHubGigetShorthand(source)
  const withPrefix = githubShorthand ?? (GITHUB_SHORTHAND_RE.test(source) ? `github:${source}` : source)
  return ref ? `${withPrefix}#${ref}` : withPrefix
}

function toGitHubGigetShorthand(source: string) {
  if (source.startsWith('github:') || source.startsWith('gh:')) {
    return source.startsWith('gh:') ? `github:${source.slice(3)}` : source
  }
  const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/.exec(source)
  if (!url) return undefined
  return `github:${url[1]}/${stripGitSuffix(url[2])}`
}

type GitHubSource = {
  owner: string
  repo: string
  repoUrl: string
  ref?: string
  urlKind?: 'tree' | 'blob'
  urlParts: string[]
}

type ResolvedGitHubSource = GitHubSource & {
  ref: string
  commitSha: string
  subdir?: string
}

type ResolveGitHubSourceOptions = {
  ref?: string
  subdir?: string
  fetchImpl?: typeof fetch
}

function parseGitHubSource(source: string): GitHubSource | undefined {
  const shorthand = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@(.+))?$/.exec(source)
  if (shorthand) return canonicalGitHubSource(shorthand[1], shorthand[2], shorthand[3]?.trim() || undefined)

  let url: URL
  try {
    url = new URL(source)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || !GITHUB_HOSTS.has(url.hostname)) return undefined
  const segments = decodePathSegments(url.pathname)
  const owner = segments[0]
  const repo = segments[1]
  if (!owner || !repo) return undefined
  const kind = segments[2] === 'tree' || segments[2] === 'blob' ? segments[2] : undefined
  return canonicalGitHubSource(owner, repo, undefined, kind, kind ? segments.slice(3) : [])
}

function canonicalGitHubSource(owner: string, repo: string, ref?: string, urlKind?: 'tree' | 'blob', urlParts: string[] = []): GitHubSource {
  const repoName = stripGitSuffix(repo)
  return {
    owner,
    repo: repoName,
    repoUrl: `https://github.com/${owner}/${repoName}`,
    ...(ref ? { ref } : {}),
    ...(urlKind ? { urlKind } : {}),
    urlParts,
  }
}

async function resolveGitHubSource(source: GitHubSource, options: ResolveGitHubSourceOptions): Promise<ResolvedGitHubSource> {
  const explicitRef = options.ref?.trim() || source.ref
  if (explicitRef) {
    const commitSha = await fetchGitHubCommitSha(source, explicitRef, { fetchImpl: options.fetchImpl })
    if (!commitSha) throw new Error(`GitHub commit resolution failed for ref ${explicitRef}.`)
    const subdir = options.subdir ?? await resolveGitHubUrlSubdir(source, options.fetchImpl)
    return {
      ...source,
      ref: explicitRef,
      commitSha,
      ...(subdir ? { subdir } : {}),
    }
  }

  const defaultBranch = await fetchGitHubDefaultBranch(source, options.fetchImpl)
  if (!source.urlKind) {
    const commitSha = await fetchGitHubCommitSha(source, defaultBranch, { fetchImpl: options.fetchImpl })
    if (!commitSha) throw new Error(`GitHub commit resolution failed for ref ${defaultBranch}.`)
    return {
      ...source,
      ref: defaultBranch,
      commitSha,
      ...(options.subdir ? { subdir: options.subdir } : {}),
    }
  }

  const urlResolution = await resolveGitHubUrlRef(source, defaultBranch, options.fetchImpl)
  return {
    ...source,
    ref: urlResolution.ref,
    commitSha: urlResolution.commitSha,
    ...(options.subdir ?? urlResolution.subdir ? { subdir: options.subdir ?? urlResolution.subdir } : {}),
  }
}

async function resolveGitHubUrlSubdir(source: GitHubSource, fetchImpl: typeof fetch = fetch) {
  if (!source.urlKind) return undefined
  const defaultBranch = await fetchGitHubDefaultBranch(source, fetchImpl)
  return (await resolveGitHubUrlRef(source, defaultBranch, fetchImpl)).subdir
}

async function resolveGitHubUrlRef(source: GitHubSource, defaultBranch: string, fetchImpl: typeof fetch = fetch) {
  for (const candidate of buildUrlRefCandidates(source.urlParts, defaultBranch)) {
    const commitSha = await fetchGitHubCommitSha(source, candidate.ref, { allowMissing: true, fetchImpl })
    if (!commitSha) continue
    return {
      ref: candidate.ref,
      commitSha,
      subdir: inferUrlSubdir(source.urlKind, source.urlParts, candidate.refPartCount),
    }
  }

  throw new Error('GitHub URL ref could not be resolved.')
}

async function fetchGitHubCommitSha(source: GitHubSource, ref: string, options: { allowMissing?: boolean; fetchImpl?: typeof fetch } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(githubApiUrl(`/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/commits/${encodeURIComponent(ref)}`), {
    method: 'GET',
    headers: githubHeaders(),
  })
  if (!response.ok) {
    if (options.allowMissing && response.status === 404) return undefined
    const snippet = await response.text().catch(() => '')
    throw new Error(`GitHub commit resolution failed (${response.status}).${snippet ? ` ${snippet.slice(0, 300)}` : ''}`)
  }
  const payload = await response.json() as Record<string, unknown>
  const commitSha = String(payload.sha ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error('GitHub commit resolution returned an invalid commit SHA')
  }
  return commitSha
}

function buildUrlRefCandidates(parts: string[], defaultBranch: string) {
  const candidates: Array<{ ref: string; refPartCount: number }> = []
  for (let count = parts.length; count >= 1; count -= 1) {
    candidates.push({ ref: parts.slice(0, count).join('/'), refPartCount: count })
  }
  if (!candidates.some((candidate) => candidate.ref === defaultBranch)) {
    candidates.push({ ref: defaultBranch, refPartCount: 0 })
  }
  return candidates
}

function inferUrlSubdir(kind: GitHubSource['urlKind'], parts: string[], refPartCount: number) {
  if (!kind) return undefined
  const sourcePathParts = parts.slice(refPartCount)
  if (kind === 'blob') sourcePathParts.pop()
  return normalizeSubdir(sourcePathParts.join('/'))
}

async function fetchGitHubDefaultBranch(source: GitHubSource, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(githubApiUrl(`/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`), {
    method: 'GET',
    headers: githubHeaders(),
  })
  if (!response.ok) {
    const snippet = await response.text().catch(() => '')
    throw new Error(`GitHub repo resolution failed (${response.status}).${snippet ? ` ${snippet.slice(0, 300)}` : ''}`)
  }
  const payload = await response.json() as Record<string, unknown>
  const defaultBranch = String(payload.default_branch ?? '').trim()
  if (!defaultBranch) throw new Error('GitHub repo resolution returned no default branch')
  return defaultBranch
}

function githubApiUrl(apiPath: string) {
  return `${process.env.GITHUB_API_BASE_URL || 'https://api.github.com'}${apiPath}`
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
  const token = process.env.GITHUB_TOKEN || process.env.AGENTRIG_TEMPLATE_TOKEN
  if (token?.trim() && shouldSendGitHubToken()) headers.Authorization = `Bearer ${token.trim()}`
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

function assertPathInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes source root: ${candidate}`)
  }
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

function normalizeSubdir(value: string | undefined) {
  if (!value) return undefined
  if (path.isAbsolute(value.trim())) throw new Error('Path escapes source root: source path must be relative')
  const normalized = value
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
  if (!normalized || normalized === '.') return undefined
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Path escapes source root: source path must not contain . or .. segments')
  }
  return segments.join('/')
}

function stripGitSuffix(value: string) {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}
