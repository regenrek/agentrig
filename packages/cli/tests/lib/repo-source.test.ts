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
      'https://github.com/acme/demo#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
      'https://github.com/acme/demo#dddddddddddddddddddddddddddddddddddddddd',
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
      'https://github.com/acme/demo#cccccccccccccccccccccccccccccccccccccccc',
      expect.any(Object)
    )

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

function mockGitHubFetch(input: { defaultBranch: string; commits: Record<string, string> }) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    if (href === 'https://api.github.com/repos/acme/demo') {
      return jsonResponse({ default_branch: input.defaultBranch })
    }

    const commitPrefix = 'https://api.github.com/repos/acme/demo/commits/'
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
