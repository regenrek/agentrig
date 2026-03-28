import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagesCliDir = path.resolve(__dirname, '../..')
const repoRoot = path.resolve(packagesCliDir, '../..')
const builtCliPath = path.join(packagesCliDir, 'dist', 'cli.js')
const vitePlaygroundDir = path.join(repoRoot, 'test', 'playgrounds', 'vite-basic')

export type E2EProject = {
  name: string
  dir: string
}

export type E2EWorkspace = {
  rootDir: string
  homeDir: string
  packsRoot: string
  distRoot: string
  projects: E2EProject[]
}

export type CliRunOptions = {
  cwd: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

export async function createE2EWorkspace(
  projectNames: string[] = ['project-a', 'project-b']
): Promise<E2EWorkspace> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-vite-e2e-'))
  const homeDir = path.join(rootDir, 'home')
  const packsRoot = path.join(rootDir, 'packs')
  const distRoot = path.join(rootDir, 'dist')
  const projects: E2EProject[] = []

  await fs.mkdir(homeDir, { recursive: true })
  await fs.mkdir(packsRoot, { recursive: true })
  await fs.mkdir(distRoot, { recursive: true })

  for (const name of projectNames) {
    const dir = path.join(rootDir, name)
    await fs.cp(vitePlaygroundDir, dir, { recursive: true })
    projects.push({ name, dir })
  }

  return { rootDir, homeDir, packsRoot, distRoot, projects }
}

export async function cleanupE2EWorkspace(workspace: E2EWorkspace | null) {
  if (!workspace) return
  await fs.rm(workspace.rootDir, { recursive: true, force: true })
}

export async function runBuiltCli(args: string[], options: CliRunOptions) {
  try {
    await fs.access(builtCliPath)
  } catch {
    throw new Error(`Built CLI not found at ${builtCliPath}. Run \`pnpm build\` in packages/cli first.`)
  }

  const env = {
    ...process.env,
    ...options.env,
    HOME: options.homeDir ?? options.env?.HOME ?? process.env.HOME,
    NO_COLOR: '1',
  }

  try {
    const result = await execFile(process.execPath, [builtCliPath, ...args], {
      cwd: options.cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    })

    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string }
    throw new Error(
      [
        `CLI command failed: node ${builtCliPath} ${args.join(' ')}`,
        failed.stdout ? `stdout:\n${failed.stdout.trim()}` : '',
        failed.stderr ? `stderr:\n${failed.stderr.trim()}` : '',
        failed.message,
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
}

export async function writeJsonFile(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export async function writeTextFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf-8')
}

export async function appendTextFile(filePath: string, contents: string) {
  await fs.appendFile(filePath, contents, 'utf-8')
}

export async function populateFullPackContents(packDir: string) {
  await writeTextFile(
    path.join(packDir, 'README.md'),
    '# Full E2E Pack\n\nThis pack is used by AgentRig Vite E2E tests.\n'
  )

  await writeTextFile(
    path.join(packDir, 'skills', 'reviewer', 'SKILL.md'),
    [
      '---',
      'name: reviewer',
      'description: Review code changes for bugs and missing tests.',
      '---',
      '',
      'Review code carefully.',
      'Prioritize regressions, behavioral risks, and missing coverage.',
      '',
    ].join('\n')
  )

  await writeTextFile(
    path.join(packDir, 'skills', 'releaser', 'SKILL.md'),
    [
      '---',
      'name: releaser',
      'description: Prepare release notes and confirm release safety checks.',
      '---',
      '',
      'Verify changelog quality.',
      'Confirm release prerequisites before shipping.',
      '',
    ].join('\n')
  )

  await writeTextFile(
    path.join(packDir, 'commands', 'deploy.md'),
    '# deploy\n\nUse this command when preparing a release or deployment.\n'
  )

  await writeTextFile(
    path.join(packDir, 'agents', 'reviewer.md'),
    '# reviewer\n\nYou are a careful reviewer focused on bugs, regressions, and missing tests.\n'
  )

  await writeTextFile(
    path.join(packDir, 'rules', 'prefer-const.mdc'),
    [
      '---',
      'description: Prefer const over let when values do not change.',
      'alwaysApply: true',
      '---',
      '',
      'Prefer `const` unless reassignment is required.',
      '',
    ].join('\n')
  )

  await writeJsonFile(path.join(packDir, 'hooks', 'hooks.json'), {
    hooks: {
      PostToolUse: [],
    },
  })

  await writeTextFile(
    path.join(packDir, 'scripts', 'echo-status.sh'),
    '#!/usr/bin/env bash\nset -eu\necho "full-e2e-pack ok"\n'
  )
  await fs.chmod(path.join(packDir, 'scripts', 'echo-status.sh'), 0o755)

  await writeTextFile(path.join(packDir, 'assets', 'notes.txt'), 'Manual test asset file.\n')

  await writeJsonFile(path.join(packDir, '.mcp.json'), {
    mcpServers: {
      demo: {
        command: 'node',
        args: ['-e', "console.log('demo mcp server')"],
      },
    },
  })

  await writeJsonFile(path.join(packDir, '.app.json'), {
    apps: [],
  })

  await writeJsonFile(path.join(packDir, 'settings.json'), {
    permissions: {
      allow: ['Bash(*)'],
    },
  })

  await writeJsonFile(path.join(packDir, '.lsp.json'), {
    servers: {},
  })
}
