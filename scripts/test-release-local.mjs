import { exec as execCallback, execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const exec = promisify(execCallback)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localVpBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vp.cmd' : 'vp'
)
const smokeOnly = process.argv.includes('--smoke-only')

function commandName(base) {
  return process.platform === 'win32' ? `${base}.cmd` : base
}

function quoteWindowsArg(value) {
  if (value.length === 0) return '""'
  if (!/[\s"&()^<>|]/.test(value)) return value
  return `"${value.replace(/["^]/g, '^$&')}"`
}

async function assertNodeShebang(filePath) {
  const contents = await fs.readFile(filePath, 'utf-8')
  const firstLine = contents.split(/\r?\n/, 1)[0]
  if (firstLine !== '#!/usr/bin/env node') {
    throw new Error(`Expected node shebang in ${filePath}, got: ${firstLine || '<empty>'}`)
  }
}

async function run(command, args, cwd = repoRoot) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const options = {
    cwd,
    env: {
      ...process.env,
      NO_COLOR: '1',
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
    },
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  }

  const result = process.platform === 'win32' && command.endsWith('.cmd')
    ? await exec(
      [quoteWindowsArg(command), ...args.map((arg) => quoteWindowsArg(String(arg)))].join(' '),
      options
    )
    : await execFile(command, args, options)

  if (result.stdout.trim()) {
    console.log(result.stdout.trim())
  }
  if (result.stderr.trim()) {
    console.error(result.stderr.trim())
  }
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-release-local-'))
  const packDir = path.join(tempRoot, 'pack')
  const installDir = path.join(tempRoot, 'install')

  try {
    await fs.access(localVpBin)
    await run(localVpBin, ['--version'])

    if (!smokeOnly) {
      await run(localVpBin, ['run', 'repo:coverage'])
      await run(localVpBin, ['run', 'repo:test:e2e'])
      await run(localVpBin, ['run', 'repo:playground:vite-plus:check'])
    }

    await run(localVpBin, ['run', 'repo:build:cli'])
    const builtCliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.mjs')
    await assertNodeShebang(builtCliPath)

    await fs.mkdir(packDir, { recursive: true })
    await run(commandName('npm'), ['pack', '--pack-destination', packDir], path.join(repoRoot, 'packages', 'cli'))

    const tarballs = (await fs.readdir(packDir)).filter((file) => file.endsWith('.tgz'))
    const tarball = tarballs.at(0)
    if (!tarball) {
      throw new Error(`No tarball was produced in ${packDir}`)
    }

    await run(commandName('npm'), ['install', '--prefix', installDir, path.join(packDir, tarball)])

    const installedCliPath = path.join(installDir, 'node_modules', 'agentrig', 'dist', 'cli.mjs')
    await assertNodeShebang(installedCliPath)

    const installedBinPath = path.join(installDir, 'node_modules', '.bin', commandName('agentrig'))
    await fs.access(installedBinPath)

    await run(installedBinPath, ['--version'])
    await run(installedBinPath, ['--help'])

    console.log('\nLocal release smoke passed.')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

await main()
