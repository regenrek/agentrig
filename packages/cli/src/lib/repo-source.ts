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
  const resolvedGitHub = await resolveGitHubCommit(githubSource, options.ref)
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-inspect-'))
  const templateSpec = toGigetSource(requestedSource, resolvedGitHub?.commitSha ?? options.ref)
  const token = process.env.GITHUB_TOKEN || process.env.AGENTRIG_TEMPLATE_TOKEN
  const downloaded = await downloadTemplate(templateSpec, {
    dir: tempDir,
    force: true,
    auth: token?.trim() ? token.trim() : undefined,
  })
  const root = downloaded.dir
  const scanRoot = options.subdir ? path.resolve(root, options.subdir) : root
  assertPathInside(root, scanRoot)

  return {
    root: scanRoot,
    source: {
      type: 'github',
      label: resolvedGitHub?.repoUrl ?? requestedSource,
      ...(resolvedGitHub?.ref ? { ref: resolvedGitHub.ref } : options.ref ? { ref: options.ref } : {}),
      ...(resolvedGitHub?.commitSha ? { commitSha: resolvedGitHub.commitSha } : {}),
      ...(options.subdir ? { subdir: options.subdir } : {}),
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
  const withPrefix = GITHUB_SHORTHAND_RE.test(source) ? `github:${source}` : source
  return ref ? `${withPrefix}#${ref}` : withPrefix
}

type GitHubSource = {
  owner: string
  repo: string
  repoUrl: string
}

function parseGitHubSource(source: string): GitHubSource | undefined {
  const shorthand = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(source)
  if (shorthand) return canonicalGitHubSource(shorthand[1], shorthand[2])

  const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(?:\/.*)?$/.exec(source)
  if (!url) return undefined
  return canonicalGitHubSource(url[1], url[2])
}

function canonicalGitHubSource(owner: string, repo: string): GitHubSource {
  const repoName = stripGitSuffix(repo)
  return {
    owner,
    repo: repoName,
    repoUrl: `https://github.com/${owner}/${repoName}`,
  }
}

async function resolveGitHubCommit(source: GitHubSource, requestedRef: string | undefined) {
  const ref = requestedRef?.trim() || await fetchGitHubDefaultBranch(source)
  const response = await fetch(githubApiUrl(`/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/commits/${encodeURIComponent(ref)}`), {
    method: 'GET',
    headers: githubHeaders(),
  })
  if (!response.ok) {
    const snippet = await response.text().catch(() => '')
    throw new Error(`GitHub commit resolution failed (${response.status}).${snippet ? ` ${snippet.slice(0, 300)}` : ''}`)
  }
  const payload = await response.json() as Record<string, unknown>
  const commitSha = String(payload.sha ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error('GitHub commit resolution returned an invalid commit SHA')
  }
  return {
    ...source,
    ref,
    commitSha,
  }
}

async function fetchGitHubDefaultBranch(source: GitHubSource) {
  const response = await fetch(githubApiUrl(`/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`), {
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
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

function assertPathInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes source root: ${candidate}`)
  }
}

function stripGitSuffix(value: string) {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}
