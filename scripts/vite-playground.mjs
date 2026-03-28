import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = path.join(repoRoot, 'test', 'playgrounds', 'vite-basic')
const expectedFiles = [
  '.gitignore',
  'README.md',
  'index.html',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'src/main.ts',
]

function stripJsonComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

function usage() {
  console.log('Usage: node scripts/vite-playground.mjs --check|--write')
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function normalizePathForLog(filePath) {
  return path.relative(repoRoot, filePath) || '.'
}

async function listFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, baseDir)))
      continue
    }
    files.push(path.relative(baseDir, fullPath).split(path.sep).join('/'))
  }
  return files
}

async function scaffoldLatestViteFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-vite-refresh-'))
  const appDir = path.join(tempRoot, 'fixture')

  try {
    await execFile(
      getNpmCommand(),
      ['create', 'vite@latest', 'fixture', '--', '--template', 'vanilla-ts'],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          npm_config_yes: 'true',
        },
        maxBuffer: 10 * 1024 * 1024,
      }
    )

    const packageJson = JSON.parse(await fs.readFile(path.join(appDir, 'package.json'), 'utf-8'))
    packageJson.name = 'vite-basic-fixture'

    const tsconfigText = await fs.readFile(path.join(appDir, 'tsconfig.json'), 'utf-8')
    const tsconfig = JSON.parse(stripJsonComments(tsconfigText))
    const gitignore = await fs.readFile(path.join(appDir, '.gitignore'), 'utf-8')
    const viteVersion = packageJson.devDependencies?.vite ?? 'unknown'

    return {
      '.gitignore': gitignore,
      'README.md': [
        '# Vite Basic Playground',
        '',
        'This fixture is the canonical consumer-project playground for AgentRig CLI E2E tests.',
        '',
        'It is intentionally small, but it is derived from the current `vanilla-ts` Vite starter created with:',
        '',
        '```bash',
        'npm create vite@latest -- --template vanilla-ts',
        '```',
        '',
        `Current scaffold baseline: \`vite ${viteVersion}\`.`,
        '',
        'The fixture is trimmed down so tests can copy it into temporary directories quickly while still exercising AgentRig against a real Vite-shaped project.',
        '',
        'Use the refresh/check script to compare this fixture against the latest Vite scaffold:',
        '',
        '```bash',
        'pnpm playground:vite:check',
        'pnpm playground:vite:refresh',
        '```',
        '',
      ].join('\n'),
      'index.html': [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>Vite Basic Fixture</title>',
        '  </head>',
        '  <body>',
        '    <div id="app"></div>',
        '    <script type="module" src="/src/main.ts"></script>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
      'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
      'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
      'vite.config.ts': "import { defineConfig } from 'vite'\n\nexport default defineConfig({})\n",
      'src/main.ts': [
        "const app = document.querySelector<HTMLDivElement>('#app')",
        '',
        'if (!app) {',
        "  throw new Error('Expected #app root element in Vite fixture')",
        '}',
        '',
        'app.innerHTML = `',
        '  <main>',
        '    <h1>Vite Basic Fixture</h1>',
        '    <p>This project is copied into temporary directories for AgentRig E2E tests.</p>',
        '  </main>',
        '`',
        '',
      ].join('\n'),
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode !== '--check' && mode !== '--write') {
    usage()
    process.exitCode = 1
    return
  }

  const generatedFiles = await scaffoldLatestViteFixture()
  const changedFiles = []

  await fs.mkdir(fixtureDir, { recursive: true })

  for (const [relativePath, contents] of Object.entries(generatedFiles)) {
    const targetPath = path.join(fixtureDir, relativePath)
    const existing = await fs.readFile(targetPath, 'utf-8').catch(() => null)
    if (existing !== contents) {
      changedFiles.push(relativePath)
      if (mode === '--write') {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.writeFile(targetPath, contents, 'utf-8')
      }
    }
  }

  const existingFiles = await listFiles(fixtureDir)
  const unexpectedFiles = existingFiles.filter((file) => !expectedFiles.includes(file))

  if (mode === '--write') {
    for (const unexpectedFile of unexpectedFiles) {
      await fs.rm(path.join(fixtureDir, unexpectedFile), { force: true })
    }
  }

  if (mode === '--check') {
    if (changedFiles.length === 0 && unexpectedFiles.length === 0) {
      console.log(`Vite playground is up to date: ${normalizePathForLog(fixtureDir)}`)
      return
    }

    if (changedFiles.length > 0) {
      console.error('Vite playground differs from the latest normalized scaffold:')
      for (const file of changedFiles) {
        console.error(`  - ${file}`)
      }
    }

    if (unexpectedFiles.length > 0) {
      console.error('Vite playground has unexpected extra files:')
      for (const file of unexpectedFiles) {
        console.error(`  - ${file}`)
      }
    }

    process.exitCode = 1
    return
  }

  console.log(`Updated Vite playground fixture: ${normalizePathForLog(fixtureDir)}`)
  if (changedFiles.length > 0) {
    for (const file of changedFiles) {
      console.log(`  - wrote ${file}`)
    }
  }
  if (unexpectedFiles.length > 0) {
    for (const file of unexpectedFiles) {
      console.log(`  - removed ${file}`)
    }
  }
}

await main()
