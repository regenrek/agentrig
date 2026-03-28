import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  cleanupE2EWorkspace,
  createE2EWorkspace,
  runBuiltCli,
  validateVpProject,
  writeJsonFile,
  writeTextFile,
  type E2EWorkspace,
} from '../helpers/e2e'
import {
  createNodeBackedCommand,
  startFixtureServer,
  withPrependedBinPath,
  type FixtureResponse,
  type FixtureServer,
} from '../helpers/harness'

const defaultPolicy = {
  maxZipBytes: 1024 * 1024,
  maxFileBytes: 16 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxFiles: 100,
  allowedContentTypes: ['application/zip'],
  blockedExtensions: ['.exe', '.dll'],
  allowedFileExtensions: ['.md', '.json', '.txt', '.sh'],
  allowedFilenames: ['README.md'],
  allowedTargetPrefixes: ['.codex/', '.claude/', '.cursor/', '.agentrig/', 'scripts/', 'tools/'],
  publishedVersionRetention: 10,
} as const

type CommunityHarness = {
  server: FixtureServer
  env: NodeJS.ProcessEnv
  state: {
    uploads: Buffer[]
    submissions: Map<string, Record<string, unknown>>
  }
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function parseJsonBody(request: { body: Buffer }) {
  return JSON.parse(request.body.toString('utf-8')) as Record<string, unknown>
}

function authError(status: number, message: string): FixtureResponse {
  return {
    status,
    body: { message },
  }
}

async function createFakeBrowserEnv(workspace: E2EWorkspace) {
  const binDir = path.join(workspace.rootDir, 'browser-bin')
  const logPath = path.join(workspace.rootDir, 'browser-open.jsonl')
  const moduleSource = `
import { promises as fs } from 'node:fs'
import path from 'node:path'

const logPath = process.env.AGENTRIG_FAKE_OPEN_LOG
const entry = { command: path.basename(process.argv[1] ?? ''), args: process.argv.slice(2) }
await fs.mkdir(path.dirname(logPath), { recursive: true })
await fs.appendFile(logPath, JSON.stringify(entry) + '\\n', 'utf-8')
`
  await createNodeBackedCommand(binDir, 'open', moduleSource)
  await createNodeBackedCommand(binDir, 'xdg-open', moduleSource)

  return withPrependedBinPath(binDir, {
    AGENTRIG_FAKE_OPEN_LOG: logPath,
  })
}

async function createCommunityHarness(
  workspace: E2EWorkspace,
  policyOverrides: Partial<typeof defaultPolicy> = {}
): Promise<CommunityHarness> {
  const env = await createFakeBrowserEnv(workspace)
  const policy = { ...defaultPolicy, ...policyOverrides }
  const state = {
    uploads: [] as Buffer[],
    submissions: new Map<string, Record<string, unknown>>(),
  }

  let server: FixtureServer | null = null
  server = await startFixtureServer({
    routes: [
      {
        method: 'POST',
        pathname: '/api/cli/auth/start',
        handler: () => ({
          body: {
            requestId: 'request-1',
            publicCode: 'TEST-1234',
            exchangeSecret: 'exchange-secret',
            expiresAt: Date.now() + 60_000,
            verificationUrl: server?.url('/verify/request-1'),
          },
        }),
      },
      {
        method: 'POST',
        pathname: '/api/cli/auth/exchange',
        handler: (request) => {
          const payload = parseJsonBody(request)
          if (
            payload.requestId !== 'request-1' ||
            payload.exchangeSecret !== 'exchange-secret'
          ) {
            return authError(401, 'Invalid exchange')
          }
          return {
            body: {
              status: 'approved',
              accessToken: 'token-1',
              expiresAt: Date.now() + 60_000,
              user: {
                userId: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
              },
            },
          }
        },
      },
      {
        pathname: '/api/cli/whoami',
        handler: (request) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          return {
            body: {
              userId: 'user-1',
              email: 'test@example.com',
              name: 'Test User',
            },
          }
        },
      },
      {
        method: 'POST',
        pathname: '/api/cli/auth/logout',
        handler: (request) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          return {
            status: 204,
            body: null,
          }
        },
      },
      {
        pathname: '/api/cli/packs/policy',
        handler: (request) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          return { body: policy }
        },
      },
      {
        method: 'POST',
        pathname: '/api/cli/packs/upload-url',
        handler: (request) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          return { body: { uploadUrl: server?.url('/uploads') } }
        },
      },
      {
        method: 'POST',
        pathname: '/uploads',
        handler: (request) => {
          state.uploads.push(request.body)
          return {
            body: {
              storageId: `storage-${state.uploads.length}`,
            },
          }
        },
      },
      {
        method: 'POST',
        pathname: '/api/cli/packs/submissions',
        handler: (request) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          const payload = parseJsonBody(request)
          const submissionId = `submission-${state.submissions.size + 1}`
          const fileName = String(payload.fileName ?? 'pack.zip')
          const match = fileName.match(/^(.+)-(\d+\.\d+\.\d+)\.zip$/)
          const submission = {
            _id: submissionId,
            fileName,
            status: 'pending_review',
            scanStatus: 'clean',
            reviewStatus: 'queued',
            reviewNote: 'Waiting for moderation.',
            packName: match?.[1],
            packVersion: match?.[2],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            scanWarnings: ['README.md is missing'],
            scanErrors: [],
          }
          state.submissions.set(submissionId, submission)
          return {
            body: {
              submissionId,
            },
          }
        },
      },
      {
        pathname: /^\/api\/cli\/packs\/submissions\/([^/]+)$/,
        handler: (request, match) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          const submissionId = match?.[1]
          const submission = submissionId ? state.submissions.get(submissionId) : null
          if (!submission) {
            return {
              status: 404,
              body: { message: 'Submission not found' },
            }
          }
          return { body: submission }
        },
      },
      {
        pathname: '/api/cli/packs/submissions',
        handler: (request) => {
          if (request.headers.authorization !== 'Bearer token-1') {
            return authError(401, 'Unauthorized')
          }
          return {
            body: {
              submissions: [...state.submissions.values()],
            },
          }
        },
      },
    ],
  })

  return { server, env, state }
}

async function createBundleReadyPack(
  workspace: E2EWorkspace,
  cwd: string,
  name = 'publish-pack'
) {
  const packDir = path.join(workspace.packsRoot, name)
  await fs.mkdir(path.join(packDir, 'skills', 'publisher'), { recursive: true })
  await fs.mkdir(path.join(packDir, 'scripts'), { recursive: true })
  await writeTextFile(
    path.join(packDir, 'skills', 'publisher', 'SKILL.md'),
    '---\nname: publisher\ndescription: Publish safely.\n---\nPublish packs carefully.\n'
  )
  await writeTextFile(
    path.join(packDir, 'scripts', 'validate.sh'),
    '#!/usr/bin/env bash\nset -eu\necho "publish-ready"\n'
  )
  await runBuiltCli(
    [
      'pack',
      'create',
      packDir,
      '--name',
      name,
      '--title',
      'Publish Pack',
      '--description',
      'Pack used for publish integration coverage.',
      '--version',
      '1.2.3',
      '--out',
      path.join(packDir, 'meta.json'),
    ],
    {
      cwd,
      homeDir: workspace.homeDir,
    }
  )
  return packDir
}

describe.sequential('e2e:community-api', () => {
  let workspace: E2EWorkspace | null = null
  let harness: CommunityHarness | null = null

  afterEach(async () => {
    await harness?.server.close()
    harness = null
    await cleanupE2EWorkspace(workspace)
    workspace = null
  })

  it('logs in, persists auth, publishes a pack, reports status, and logs out', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    harness = await createCommunityHarness(workspace)
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    const packDir = await createBundleReadyPack(workspace, project.dir)

    const login = await runBuiltCli(['login', '--baseUrl', harness.server.baseUrl], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env: harness.env,
    })
    expect(login.stdout).toContain('Login code: TEST-1234')
    expect(login.stdout).toContain('eingeloggt als Test User')

    const authPath = path.join(workspace.homeDir, '.agentrig', 'auth.json')
    expect(await pathExists(authPath)).toBe(true)
    if (process.platform !== 'win32') {
      const stat = await fs.stat(authPath)
      expect(stat.mode & 0o777).toBe(0o600)
    }

    const whoami = await runBuiltCli(['whoami', '--baseUrl', harness.server.baseUrl], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env: harness.env,
    })
    expect(whoami.stdout).toContain('eingeloggt als Test User')

    const publish = await runBuiltCli(
      ['pack', 'publish', packDir, '--baseUrl', harness.server.baseUrl, '--keep-bundle'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: harness.env,
      }
    )
    expect(publish.stdout).toContain('Submission: submission-1')
    expect(publish.stdout).toContain('Status: pending_review')
    expect(publish.stdout).toContain('Bundle kept at:')
    expect(harness.state.uploads).toHaveLength(1)
    expect(harness.state.uploads[0]?.length).toBeGreaterThan(0)

    const status = await runBuiltCli(
      ['pack', 'status', 'submission-1', '--baseUrl', harness.server.baseUrl],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: harness.env,
      }
    )
    expect(status.stdout).toContain('Submission: submission-1')
    expect(status.stdout).toContain('Review status: queued')
    expect(status.stdout).toContain('Review note: Waiting for moderation.')

    const logout = await runBuiltCli(['logout', '--baseUrl', harness.server.baseUrl], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env: harness.env,
    })
    expect(logout.stdout).toContain('Logged out.')
    expect(await pathExists(authPath)).toBe(false)
  })

  it('fails when no session is present and rejects symlinked bundle inputs', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    harness = await createCommunityHarness(workspace)
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    await expect(
      runBuiltCli(['whoami', '--baseUrl', harness.server.baseUrl], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: harness.env,
      })
    ).rejects.toThrow('Not logged in. Run `agentrig login` first.')

    await runBuiltCli(['login', '--baseUrl', harness.server.baseUrl], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env: harness.env,
    })

    const packDir = path.join(workspace.packsRoot, 'symlink-pack')
    await fs.mkdir(path.join(packDir, 'skills', 'symlink'), { recursive: true })
    await writeTextFile(path.join(packDir, 'real-skill.md'), '# real\n')
    await fs.symlink(
      path.join(packDir, 'real-skill.md'),
      path.join(packDir, 'skills', 'symlink', 'SKILL.md')
    )
    await writeJsonFile(path.join(packDir, 'meta.json'), {
      name: 'symlink-pack',
      title: 'Symlink Pack',
      description: 'Pack with a symlinked file.',
      version: '1.0.0',
      files: [
        {
          path: 'skills/symlink/SKILL.md',
          target: '.codex/skills/symlink/SKILL.md',
        },
      ],
    })

    const outPath = path.join(packDir, 'symlink-pack.zip')
    await expect(
      runBuiltCli(
        ['pack', 'bundle', packDir, '--baseUrl', harness.server.baseUrl, '--out', outPath],
        {
          cwd: project.dir,
          homeDir: workspace.homeDir,
          env: harness.env,
        }
      )
    ).rejects.toThrow('Symlinks are not allowed in publish bundles')
    expect(await pathExists(outPath)).toBe(false)
  })

  it('rejects blocked or oversized bundles before upload', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    harness = await createCommunityHarness(workspace, {
      maxFileBytes: 256,
    })
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    await runBuiltCli(['login', '--baseUrl', harness.server.baseUrl], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env: harness.env,
    })

    const packDir = path.join(workspace.packsRoot, 'invalid-publish-pack')
    await fs.mkdir(path.join(packDir, 'bin'), { recursive: true })
    await fs.mkdir(path.join(packDir, 'skills', 'big'), { recursive: true })
    await writeTextFile(path.join(packDir, 'bin', 'demo.exe'), 'not-allowed\n')
    await writeTextFile(path.join(packDir, 'skills', 'big', 'SKILL.md'), 'x'.repeat(1024))
    await writeJsonFile(path.join(packDir, 'meta.json'), {
      name: 'invalid-publish-pack',
      title: 'Invalid Publish Pack',
      description: 'Pack that fails local validation.',
      version: '1.0.0',
      files: [
        {
          path: 'bin/demo.exe',
          target: '.codex/skills/demo.exe',
        },
        {
          path: 'skills/big/SKILL.md',
          target: '.codex/skills/big/SKILL.md',
        },
      ],
    })

    await expect(
      runBuiltCli(['pack', 'publish', packDir, '--baseUrl', harness.server.baseUrl], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: harness.env,
      })
    ).rejects.toThrow('Pack publish failed local validation:')
    expect(harness.state.uploads).toHaveLength(0)
  })
})
