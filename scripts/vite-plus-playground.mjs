import { exec as execCallback, execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execCallback)
const execFile = promisify(execFileCallback)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = path.join(repoRoot, 'test', 'playgrounds', 'vite-plus-application')
const rootPackageJsonPath = path.join(repoRoot, 'package.json')
const localVpBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vp.cmd' : 'vp'
)
const expectedFiles = [
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'index.html',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'src/counter.ts',
  'src/main.ts',
  'src/style.css',
]

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function usage() {
  console.log('Usage: node scripts/vite-plus-playground.mjs --check|--write')
}

function normalizePathForLog(filePath) {
  return path.relative(repoRoot, filePath) || '.'
}

function quoteWindowsArg(value) {
  if (value.length === 0) return '""'
  if (!/[\s"&()^<>|]/.test(value)) return value
  return `"${value.replace(/["^]/g, '^$&')}"`
}

async function runCommand(command, args, options) {
  const execOptions = {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  }

  return process.platform === 'win32' && command.endsWith('.cmd')
    ? exec([quoteWindowsArg(command), ...args.map((arg) => quoteWindowsArg(String(arg)))].join(' '), execOptions)
    : execFile(command, args, execOptions)
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

async function scaffoldLatestVitePlusFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-vite-plus-refresh-'))
  const appDir = path.join(tempRoot, 'fixture')

  try {
    const rootPackageJson = JSON.parse(await fs.readFile(rootPackageJsonPath, 'utf-8'))
    const packageManager = rootPackageJson.packageManager ?? 'pnpm'

    await runCommand(
      localVpBin,
      [
        'create',
        'vite:application',
        '--no-interactive',
        '--directory',
        'fixture',
        '--package-manager',
        'pnpm',
      ],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          PATH: `${path.dirname(localVpBin)}${path.delimiter}${process.env.PATH ?? ''}`,
          npm_config_yes: 'true',
        },
      }
    )

    const packageJson = JSON.parse(await fs.readFile(path.join(appDir, 'package.json'), 'utf-8'))
    packageJson.name = 'agentrig-vite-plus-fixture'
    packageJson.packageManager = packageManager
    if (packageJson.pnpm?.overrides?.vitest) {
      delete packageJson.pnpm.overrides.vitest
      if (Object.keys(packageJson.pnpm.overrides).length === 0) {
        delete packageJson.pnpm.overrides
      }
      if (Object.keys(packageJson.pnpm).length === 0) {
        delete packageJson.pnpm
      }
    }

    const tsconfigText = await fs.readFile(path.join(appDir, 'tsconfig.json'), 'utf-8')
    const tsconfig = JSON.parse(stripJsonComments(tsconfigText))
    const gitignore = await fs.readFile(path.join(appDir, '.gitignore'), 'utf-8')
    const agents = await fs.readFile(path.join(appDir, 'AGENTS.md'), 'utf-8')
    const viteConfig = await fs.readFile(path.join(appDir, 'vite.config.ts'), 'utf-8')
    const vitePlusVersion = packageJson.devDependencies?.['vite-plus'] ?? 'unknown'
    const viteVersion = packageJson.devDependencies?.vite ?? 'unknown'

    return {
      '.gitignore': gitignore,
      'AGENTS.md': agents,
      'README.md': [
        '# Vite+ Application Playground',
        '',
        'This fixture is the canonical Vite+ consumer-project playground for AgentRig CLI E2E tests.',
        '',
        'It is derived from a real `vp create vite:application` scaffold and then normalized so tests can copy it into temporary directories quickly.',
        '',
        `Current scaffold baseline: \`vite-plus ${vitePlusVersion}\` with \`${viteVersion}\`.`,
        '',
        'Use the refresh/check script to compare this fixture against the latest normalized Vite+ scaffold:',
        '',
        '```bash',
        'pnpm playground:vite-plus:check',
        'pnpm playground:vite-plus:refresh',
        '```',
        '',
      ].join('\n'),
      'index.html': [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>AgentRig Vite+ Fixture</title>',
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
      'vite.config.ts': viteConfig,
      'src/counter.ts': [
        'export function setupCounter(element: HTMLButtonElement) {',
        '  let counter = 0',
        '  const setCounter = (count: number) => {',
        '    counter = count',
        '    element.innerHTML = `Count is ${counter}`',
        '  }',
        '  element.addEventListener(\'click\', () => setCounter(counter + 1))',
        '  setCounter(0)',
        '}',
        '',
      ].join('\n'),
      'src/main.ts': [
        "import './style.css'",
        "import { setupCounter } from './counter.ts'",
        '',
        "const app = document.querySelector<HTMLDivElement>('#app')",
        '',
        'if (!app) {',
        "  throw new Error('Expected #app root element in Vite+ fixture')",
        '}',
        '',
        'app.innerHTML = `',
        '  <main class="shell">',
        '    <p class="eyebrow">AgentRig E2E Fixture</p>',
        '    <h1>Vite+ application baseline</h1>',
        '    <p class="body">',
        '      This project is copied into temporary directories and validated before AgentRig export/install checks run.',
        '    </p>',
        '    <button id="counter" type="button" class="counter"></button>',
        '  </main>',
        '`',
        '',
        "const counter = document.querySelector<HTMLButtonElement>('#counter')",
        '',
        'if (!counter) {',
        "  throw new Error('Expected #counter button in Vite+ fixture')",
        '}',
        '',
        'setupCounter(counter)',
        '',
      ].join('\n'),
      'src/style.css': [
        ':root {',
        '  color: #e5e7eb;',
        '  background: #0f172a;',
        '  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
        '  line-height: 1.5;',
        '  font-weight: 400;',
        '  text-rendering: optimizeLegibility;',
        '  -webkit-font-smoothing: antialiased;',
        '  -moz-osx-font-smoothing: grayscale;',
        '}',
        '',
        '* {',
        '  box-sizing: border-box;',
        '}',
        '',
        'body {',
        '  margin: 0;',
        '  min-height: 100vh;',
        '  background:',
        '    radial-gradient(circle at top, rgba(168, 85, 247, 0.28), transparent 32%),',
        '    linear-gradient(180deg, #111827 0%, #020617 100%);',
        '}',
        '',
        '#app {',
        '  min-height: 100vh;',
        '  display: grid;',
        '  place-items: center;',
        '  padding: 24px;',
        '}',
        '',
        '.shell {',
        '  width: min(100%, 720px);',
        '  padding: 40px;',
        '  border: 1px solid rgba(148, 163, 184, 0.2);',
        '  border-radius: 24px;',
        '  background: rgba(15, 23, 42, 0.84);',
        '  box-shadow: 0 24px 80px rgba(2, 6, 23, 0.45);',
        '}',
        '',
        '.eyebrow {',
        '  margin: 0 0 12px;',
        '  color: #c084fc;',
        '  font-size: 0.875rem;',
        '  font-weight: 700;',
        '  letter-spacing: 0.08em;',
        '  text-transform: uppercase;',
        '}',
        '',
        'h1 {',
        '  margin: 0;',
        '  font-size: clamp(2.25rem, 6vw, 3.5rem);',
        '  line-height: 1.05;',
        '}',
        '',
        '.body {',
        '  margin: 16px 0 0;',
        '  max-width: 60ch;',
        '  color: #cbd5e1;',
        '}',
        '',
        '.counter {',
        '  margin-top: 24px;',
        '  padding: 0.85rem 1.1rem;',
        '  border: 1px solid rgba(192, 132, 252, 0.4);',
        '  border-radius: 999px;',
        '  background: rgba(168, 85, 247, 0.12);',
        '  color: #f5f3ff;',
        '  font: inherit;',
        '  cursor: pointer;',
        '  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;',
        '}',
        '',
        '.counter:hover {',
        '  transform: translateY(-1px);',
        '  border-color: rgba(216, 180, 254, 0.8);',
        '  background: rgba(168, 85, 247, 0.18);',
        '}',
        '',
        '.counter:focus-visible {',
        '  outline: 2px solid #e9d5ff;',
        '  outline-offset: 3px;',
        '}',
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

  try {
    await fs.access(localVpBin)
  } catch {
    throw new Error(`Local Vite+ binary not found at ${localVpBin}. Install repo dependencies first (for example, \`pnpm install\`).`)
  }

  const generatedFiles = await scaffoldLatestVitePlusFixture()
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
      console.log(`Vite+ playground is up to date: ${normalizePathForLog(fixtureDir)}`)
      return
    }

    if (changedFiles.length > 0) {
      console.error('Vite+ playground differs from the latest normalized scaffold:')
      for (const file of changedFiles) {
        console.error(`  - ${file}`)
      }
    }

    if (unexpectedFiles.length > 0) {
      console.error('Vite+ playground has unexpected extra files:')
      for (const file of unexpectedFiles) {
        console.error(`  - ${file}`)
      }
    }

    process.exitCode = 1
    return
  }

  console.log(`Updated Vite+ playground fixture: ${normalizePathForLog(fixtureDir)}`)
  for (const file of changedFiles) {
    console.log(`  - wrote ${file}`)
  }
  for (const file of unexpectedFiles) {
    console.log(`  - removed ${file}`)
  }
}

await main()
