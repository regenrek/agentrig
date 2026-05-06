import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeGitHubRepo, resolveSubmitSource } from '../../src/lib/submit-source'

const tempDirs: string[] = []

describe('submit source resolver', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('normalizes GitHub repository shapes', () => {
    expect(normalizeGitHubRepo('acme/demo')).toBe('acme/demo')
    expect(normalizeGitHubRepo('git@github.com:acme/demo.git')).toBe('acme/demo')
    expect(normalizeGitHubRepo('https://github.com/acme/demo.git')).toBe('acme/demo')
    expect(normalizeGitHubRepo('https://gitlab.example.com/acme/demo')).toBeUndefined()
  })

  it('resolves owner/repo@tag by asking GitHub for the commit', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      object: {
        type: 'commit',
        sha: '1234567890abcdef1234567890abcdef12345678',
      },
    })))

    await expect(resolveSubmitSource({
      source: 'acme/demo-plugin@v1.2.3',
      fetchImpl,
    })).resolves.toEqual({
      upstream_repo: 'https://github.com/acme/demo-plugin',
      upstream_tag: 'v1.2.3',
      upstream_commit_sha: '1234567890abcdef1234567890abcdef12345678',
      plugin_path: '.',
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/demo-plugin/git/ref/tags/v1.2.3',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('tries v-prefixed versions before bare versions for remote sources', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/git/ref/tags/v1.2.3')) return new Response('', { status: 404 })
      return new Response(JSON.stringify({
        object: {
          type: 'commit',
          sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
      }))
    })

    await expect(resolveSubmitSource({
      source: 'https://github.com/acme/demo-plugin',
      version: '1.2.3',
      path: 'plugin',
      fetchImpl,
    })).resolves.toEqual({
      upstream_repo: 'https://github.com/acme/demo-plugin',
      upstream_tag: '1.2.3',
      upstream_commit_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      plugin_path: 'plugin',
    })
  })

  it('rejects absolute repo subpaths', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      object: {
        type: 'commit',
        sha: '1234567890abcdef1234567890abcdef12345678',
      },
    })))

    await expect(resolveSubmitSource({
      source: 'acme/demo-plugin@v1.2.3',
      path: '/tmp/plugin',
      fetchImpl,
    })).rejects.toThrow('stay inside the repository')
  })

  it('does not accept branches or raw SHAs as remote tags', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))

    await expect(resolveSubmitSource({
      source: 'acme/demo-plugin@main',
      fetchImpl,
    })).rejects.toThrow('GitHub tag not found')

    await expect(resolveSubmitSource({
      source: 'acme/demo-plugin@1234567890abcdef1234567890abcdef12345678',
      fetchImpl,
    })).rejects.toThrow('GitHub tag not found')
  })

  it('rejects /tree/, /blob/, and deeper GitHub URLs as submit sources', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }))

    await expect(resolveSubmitSource({
      source: 'https://github.com/acme/demo-plugin/tree/main/plugin',
      fetchImpl,
    })).rejects.toThrow('https://github.com/<owner>/<repo>')

    await expect(resolveSubmitSource({
      source: 'https://github.com/acme/demo-plugin/blob/main/README.md',
      fetchImpl,
    })).rejects.toThrow('https://github.com/<owner>/<repo>')

    await expect(resolveSubmitSource({
      source: 'https://github.com/acme/demo-plugin/releases/tag/v1.2.3',
      fetchImpl,
    })).rejects.toThrow('https://github.com/<owner>/<repo>')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks trusted expected commits against the resolved tag commit', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      object: {
        type: 'commit',
        sha: '1234567890abcdef1234567890abcdef12345678',
      },
    })))

    await expect(resolveSubmitSource({
      source: 'acme/demo-plugin@v1.2.3',
      expectedCommitSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      fetchImpl,
    })).rejects.toThrow('does not match expected commit')
  })

  it('does not send GitHub tokens to untrusted API base hosts', async () => {
    let authorization: string | undefined
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = (init?.headers as Record<string, string> | undefined)?.Authorization
      return new Response(JSON.stringify({
        object: {
          type: 'commit',
          sha: '1234567890abcdef1234567890abcdef12345678',
        },
      }))
    })

    await resolveSubmitSource({
      source: 'acme/demo-plugin@v1.2.3',
      env: {
        GITHUB_API_BASE_URL: 'https://evil.example.test',
        GITHUB_TOKEN: 'secret-token',
      },
      fetchImpl,
    })

    expect(authorization).toBeUndefined()
  })

  it('resolves a tagged local git checkout to canonical upstream metadata', async () => {
    const repo = await tempRoot()
    await mkdir(path.join(repo, 'plugin'), { recursive: true })
    await writeFile(path.join(repo, 'plugin', 'README.md'), 'demo\n', 'utf8')
    runGit(repo, ['init', '-b', 'main'])
    runGit(repo, ['remote', 'add', 'origin', 'git@github.com:acme/demo-plugin.git'])
    runGit(repo, ['add', '.'])
    runGit(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])
    const commit = runGit(repo, ['rev-parse', 'HEAD'])
    runGit(repo, ['-c', 'tag.gpgSign=false', 'tag', 'v1.2.3'])

    await expect(resolveSubmitSource({
      source: 'plugin',
      workdir: repo,
    })).resolves.toEqual({
      upstream_repo: 'https://github.com/acme/demo-plugin',
      upstream_tag: 'v1.2.3',
      upstream_commit_sha: commit,
      plugin_path: 'plugin',
    })
  })

  it('does not accept a local branch name as a version tag', async () => {
    const repo = await tempRoot()
    await writeFile(path.join(repo, 'README.md'), 'demo\n', 'utf8')
    runGit(repo, ['init', '-b', 'v1.2.3'])
    runGit(repo, ['remote', 'add', 'origin', 'git@github.com:acme/demo-plugin.git'])
    runGit(repo, ['add', '.'])
    runGit(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])

    await expect(resolveSubmitSource({
      source: '.',
      workdir: repo,
      version: '1.2.3',
    })).rejects.toThrow('tag that points at HEAD')
  })
})

async function tempRoot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentrig-submit-source-'))
  tempDirs.push(dir)
  return dir
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}
