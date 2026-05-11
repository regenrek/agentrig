import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import packageJson from '../../package.json'
import { codexInstallPlugin, codexUninstallPlugin } from '../../src/lib/plugin-providers/codex-app-server'

const tempDirs: string[] = []
const originalPath = process.env.PATH

describe('codex app-server JSON-RPC driver', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('sends initialize, initialized, and plugin/install over line-delimited stdio', async () => {
    const fake = await createFakeCodex()
    vi.stubEnv('PATH', `${fake.binDir}${path.delimiter}${originalPath ?? ''}`)
    vi.stubEnv('CODEX_HOME', fake.codexHome)

    const result = await codexInstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
      version: '1.2.3',
      sourcePath: path.join(fake.root, 'marketplace.json'),
      enable: true,
    })

    expect(result).toMatchObject({
      ok: true,
      installPath: path.join(fake.codexHome, 'plugins', 'cache', 'agentrig-local', 'agentrig-regenrek-agent-skills', '1.2.3'),
      authPolicy: 'ON_INSTALL',
      appsNeedingAuth: [],
    })
    const messages = await readMessages(fake.logPath)
    expect(messages[0]).toMatchObject({
      type: 'args',
      args: ['app-server', '--listen', 'stdio://'],
    })
    expect(messages[1]).toMatchObject({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'agentrig', title: 'AgentRig', version: packageJson.version },
        capabilities: { experimentalApi: false },
      },
    })
    expect(messages[2]).toEqual({ method: 'initialized' })
    expect(messages[3]).toMatchObject({
      id: 2,
      method: 'plugin/install',
      params: {
        marketplacePath: path.join(fake.root, 'marketplace.json'),
        remoteMarketplaceName: null,
        pluginName: 'agentrig-regenrek-agent-skills',
      },
    })
    await expect(fs.readFile(fake.closePath, 'utf-8')).resolves.toBe('stdin-ended')
  })

  it('writes Codex plugin enablement when --no-enable is requested', async () => {
    const fake = await createFakeCodex()
    vi.stubEnv('PATH', `${fake.binDir}${path.delimiter}${originalPath ?? ''}`)

    const result = await codexInstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
      version: '1.2.3',
      sourcePath: path.join(fake.root, 'marketplace.json'),
      enable: false,
    })

    expect(result.ok).toBe(true)
    const configWrite = (await readMessages(fake.logPath)).find((message) => message.method === 'config/value/write')
    expect(configWrite).toMatchObject({
      method: 'config/value/write',
      params: {
        keyPath: 'plugins.agentrig-regenrek-agent-skills@agentrig-local',
        value: { enabled: false },
        mergeStrategy: 'upsert',
        filePath: null,
        expectedVersion: null,
      },
    })
  })

  it('sends plugin/uninstall with the marketplace-qualified plugin id', async () => {
    const fake = await createFakeCodex()
    vi.stubEnv('PATH', `${fake.binDir}${path.delimiter}${originalPath ?? ''}`)

    const result = await codexUninstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
    })

    expect(result).toEqual({ ok: true })
    const uninstall = (await readMessages(fake.logPath)).find((message) => message.method === 'plugin/uninstall')
    expect(uninstall).toMatchObject({
      method: 'plugin/uninstall',
      params: { pluginId: 'agentrig-regenrek-agent-skills@agentrig-local' },
    })
  })

  it('rejects Codex versions below the app-server plugin floor', async () => {
    const fake = await createFakeCodex({ userAgent: 'codex/0.109.0' })
    vi.stubEnv('PATH', `${fake.binDir}${path.delimiter}${originalPath ?? ''}`)

    const result = await codexInstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
      version: '1.2.3',
      sourcePath: path.join(fake.root, 'marketplace.json'),
      enable: true,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'codex_too_old',
    })
    if (result.ok) throw new Error('expected codex_too_old')
    expect(result.detail).toContain('0.109.0')
    expect(result.detail).toContain('0.113.0')
  })

  it('reports codex_not_installed when the codex binary is missing', async () => {
    const root = await tempRoot()
    vi.stubEnv('PATH', root)

    const result = await codexInstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
      version: '1.2.3',
      sourcePath: path.join(root, 'marketplace.json'),
      enable: true,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'codex_not_installed',
    })
  })

  it('times out when the server does not answer a request', async () => {
    const fake = await createFakeCodex({ mode: 'timeout' })
    vi.stubEnv('PATH', `${fake.binDir}${path.delimiter}${originalPath ?? ''}`)
    vi.stubEnv('AGENTRIG_CODEX_APP_SERVER_INSTALL_TIMEOUT_MS', '25')

    const result = await codexInstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
      version: '1.2.3',
      sourcePath: path.join(fake.root, 'marketplace.json'),
      enable: true,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'timeout',
    })
  })

  it('returns rpc_error details with code, message, and stderr tail', async () => {
    const fake = await createFakeCodex({ mode: 'rpc-error' })
    vi.stubEnv('PATH', `${fake.binDir}${path.delimiter}${originalPath ?? ''}`)

    const result = await codexInstallPlugin({
      marketplaceName: 'agentrig-local',
      pluginName: 'agentrig-regenrek-agent-skills',
      version: '1.2.3',
      sourcePath: path.join(fake.root, 'marketplace.json'),
      enable: true,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'rpc_error',
    })
    if (result.ok) throw new Error('expected rpc_error')
    expect(result.detail).toContain('-32001')
    expect(result.detail).toContain('install failed')
    expect(result.detail).toContain('stderr detail from fake codex')
  })
})

async function createFakeCodex(options: { mode?: string; userAgent?: string } = {}) {
  const root = await tempRoot()
  const binDir = path.join(root, 'bin')
  const codexHome = path.join(root, 'codex-home')
  const logPath = path.join(root, 'messages.jsonl')
  const closePath = path.join(root, 'stdin-close.txt')
  const scriptPath = path.join(binDir, 'codex')
  await fs.mkdir(binDir, { recursive: true })
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(
    scriptPath,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

const mode = ${JSON.stringify(options.mode ?? 'normal')}
const userAgent = ${JSON.stringify(options.userAgent ?? 'codex/0.130.0')}
const logPath = ${JSON.stringify(logPath)}
const closePath = ${JSON.stringify(closePath)}
appendFileSync(logPath, JSON.stringify({ type: 'args', args: process.argv.slice(2) }) + '\\n')

const rl = readline.createInterface({ input: process.stdin })
process.stdin.on('end', () => {
  writeFileSync(closePath, 'stdin-ended')
})
rl.on('line', (line) => {
  appendFileSync(logPath, line + '\\n')
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent } }) + '\\n')
    return
  }
  if (message.method === 'plugin/install' && mode === 'timeout') {
    return
  }
  if (message.method === 'plugin/install' && mode === 'rpc-error') {
    console.error('stderr detail from fake codex')
    process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32001, message: 'install failed' } }) + '\\n')
    return
  }
  if (message.method === 'plugin/install') {
    process.stdout.write(JSON.stringify({ id: message.id, result: { authPolicy: 'ON_INSTALL', appsNeedingAuth: [] } }) + '\\n')
    return
  }
  if (message.method === 'plugin/uninstall' || message.method === 'config/value/write') {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n')
  }
})
`
  )
  await fs.chmod(scriptPath, 0o755)
  return { root, binDir, codexHome, logPath, closePath }
}

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-codex-app-server-'))
  tempDirs.push(dir)
  return dir
}

async function readMessages(logPath: string) {
  const raw = await fs.readFile(logPath, 'utf-8')
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}
