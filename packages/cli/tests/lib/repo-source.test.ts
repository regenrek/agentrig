import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRepoSource } from '../../src/lib/repo-source'

const tempDirs: string[] = []

describe('repo source resolver', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('resolves tree URL refs and subdirectories without --ref', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'main',
      commits: {
        'feature/cli': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })

    const resolved = await resolveRepoSource({
      source: 'https://github.com/acme/demo/tree/feature/cli/plugins/cursor',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    expect(resolved.source).toMatchObject({
      type: 'github',
      label: 'https://github.com/acme/demo',
      ref: 'feature/cli',
      commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      subdir: 'plugins/cursor',
    })
    expect(resolved.root).toBe(path.join(repoRoot, 'plugins', 'cursor'))
    expect(downloadTemplateMock).toHaveBeenCalledWith(
      'github:acme/demo#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      expect.objectContaining({ dir: expect.any(String), force: true })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/demo/commits/feature%2Fcli%2Fplugins%2Fcursor',
      expect.any(Object)
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/demo/commits/feature%2Fcli',
      expect.any(Object)
    )

    await resolved.cleanup()
  })

  it('resolves blob URLs to the containing directory', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'main',
      commits: {
        main: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    })

    const resolved = await resolveRepoSource({
      source: 'https://github.com/acme/demo/blob/main/packages/cli/src/index.ts',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    expect(resolved.source).toMatchObject({
      type: 'github',
      label: 'https://github.com/acme/demo',
      ref: 'main',
      commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      subdir: 'packages/cli/src',
    })
    expect(resolved.root).toBe(path.join(repoRoot, 'packages', 'cli', 'src'))

    await resolved.cleanup()
  })

  it('keeps URL subdirectories when --ref overrides the URL ref', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'main',
      commits: {
        main: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'release/candidate': 'dddddddddddddddddddddddddddddddddddddddd',
      },
    })

    const resolved = await resolveRepoSource({
      source: 'https://github.com/acme/demo/tree/main/plugins/cursor',
      ref: 'release/candidate',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    expect(resolved.source).toMatchObject({
      type: 'github',
      label: 'https://github.com/acme/demo',
      ref: 'release/candidate',
      commitSha: 'dddddddddddddddddddddddddddddddddddddddd',
      subdir: 'plugins/cursor',
    })
    expect(resolved.root).toBe(path.join(repoRoot, 'plugins', 'cursor'))
    expect(downloadTemplateMock).toHaveBeenCalledWith(
      'github:acme/demo#dddddddddddddddddddddddddddddddddddddddd',
      expect.any(Object)
    )

    await resolved.cleanup()
  })

  it('keeps blob URL containing directories when --ref overrides the URL ref', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'main',
      commits: {
        main: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'release/candidate': 'dddddddddddddddddddddddddddddddddddddddd',
      },
    })

    const resolved = await resolveRepoSource({
      source: 'https://github.com/acme/demo/blob/main/packages/cli/src/index.ts',
      ref: 'release/candidate',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    expect(resolved.source).toMatchObject({
      type: 'github',
      label: 'https://github.com/acme/demo',
      ref: 'release/candidate',
      commitSha: 'dddddddddddddddddddddddddddddddddddddddd',
      subdir: 'packages/cli/src',
    })
    expect(resolved.root).toBe(path.join(repoRoot, 'packages', 'cli', 'src'))

    await resolved.cleanup()
  })

  it('keeps owner/repo default branch detection for plain remote sources', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'trunk',
      commits: {
        trunk: 'cccccccccccccccccccccccccccccccccccccccc',
      },
    })

    const resolved = await resolveRepoSource({
      source: 'acme/demo',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    expect(resolved.source).toMatchObject({
      type: 'github',
      label: 'https://github.com/acme/demo',
      ref: 'trunk',
      commitSha: 'cccccccccccccccccccccccccccccccccccccccc',
    })
    expect(downloadTemplateMock).toHaveBeenCalledWith(
      'github:acme/demo#cccccccccccccccccccccccccccccccccccccccc',
      expect.any(Object)
    )

    await resolved.cleanup()
  })

  it('uses the github giget provider for owner/repo shorthand sources', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'main',
      commits: {
        '0a7a0d984033fa6d6ff4ef2b50bdd9eb06a3a6c5': '0a7a0d984033fa6d6ff4ef2b50bdd9eb06a3a6c5',
      },
      owner: 'joelhooks',
      repo: 'effectts-skills',
    })

    const resolved = await resolveRepoSource({
      source: 'joelhooks/effectts-skills',
      ref: '0a7a0d984033fa6d6ff4ef2b50bdd9eb06a3a6c5',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    expect(downloadTemplateMock).toHaveBeenCalledWith(
      'github:joelhooks/effectts-skills#0a7a0d984033fa6d6ff4ef2b50bdd9eb06a3a6c5',
      expect.objectContaining({ dir: expect.any(String), force: true })
    )

    await resolved.cleanup()
  })

  it('does not send GitHub tokens to custom API bases', async () => {
    const repoRoot = await createRepoRoot()
    const downloadTemplateMock = vi.fn(async () => ({ dir: repoRoot }))
    const fetchMock = mockGitHubFetch({
      defaultBranch: 'main',
      commits: {
        main: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
      apiBaseUrl: 'https://github-api.evil.test',
    })
    vi.stubEnv('GITHUB_API_BASE_URL', 'https://github-api.evil.test')
    vi.stubEnv('GITHUB_TOKEN', 'secret-token')

    const resolved = await resolveRepoSource({
      source: 'acme/demo',
      fetchImpl: fetchMock,
      downloadTemplateImpl: downloadTemplateMock,
    })

    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.headers).not.toMatchObject({
        Authorization: expect.any(String),
      })
    }

    await resolved.cleanup()
  })
})

async function createRepoRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-repo-source-'))
  tempDirs.push(root)
  await fs.mkdir(path.join(root, 'plugins', 'cursor'), { recursive: true })
  await fs.mkdir(path.join(root, 'packages', 'cli', 'src'), { recursive: true })
  return root
}

function mockGitHubFetch(input: {
  defaultBranch: string
  commits: Record<string, string>
  apiBaseUrl?: string
  owner?: string
  repo?: string
}) {
  const owner = input.owner ?? 'acme'
  const repo = input.repo ?? 'demo'
  const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const href = String(url)
    const apiBaseUrl = input.apiBaseUrl ?? 'https://api.github.com'
    if (href === `${apiBaseUrl}/repos/${owner}/${repo}`) {
      return jsonResponse({ default_branch: input.defaultBranch })
    }

    const commitPrefix = `${apiBaseUrl}/repos/${owner}/${repo}/commits/`
    if (href.startsWith(commitPrefix)) {
      const ref = decodeURIComponent(href.slice(commitPrefix.length))
      const sha = input.commits[ref]
      if (sha) return jsonResponse({ sha })
      return new Response('not found', { status: 404 })
    }

    return new Response('unexpected url', { status: 500 })
  })
  return fetchMock
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
