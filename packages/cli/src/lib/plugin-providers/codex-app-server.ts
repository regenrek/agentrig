import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import packageJson from '../../../package.json'

const MIN_CODEX_VERSION = '0.113.0'
const STDERR_BUFFER_BYTES = 8 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_INSTALL_TIMEOUT_MS = 60_000

export interface CodexInstallParams {
  marketplaceName: string
  pluginName: string
  version: string
  sourcePath: string
  enable: boolean
}

export type CodexInstallResult =
  | { ok: true; installPath: string; authPolicy: 'ON_INSTALL' | 'ON_USE'; appsNeedingAuth: unknown[] }
  | { ok: false; reason: 'codex_not_installed' | 'codex_too_old' | 'rpc_error' | 'timeout'; detail: string }

type CodexUninstallResult =
  | { ok: true }
  | { ok: false; reason: 'codex_not_installed' | 'codex_too_old' | 'rpc_error' | 'timeout'; detail: string }

type JsonObject = Record<string, unknown>

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type RpcErrorPayload = {
  code?: number
  message?: string
  data?: unknown
}

class CodexUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexUnavailableError'
  }
}

class CodexTooOldError extends Error {
  constructor(
    readonly detectedVersion: string | undefined,
    readonly minimumVersion = MIN_CODEX_VERSION
  ) {
    super(
      detectedVersion
        ? `Codex ${minimumVersion} or newer is required; detected ${detectedVersion}.`
        : `Codex ${minimumVersion} or newer is required; could not detect the running Codex version.`
    )
    this.name = 'CodexTooOldError'
  }
}

class CodexRpcTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`${method} timed out after ${timeoutMs}ms`)
    this.name = 'CodexRpcTimeoutError'
  }
}

class CodexRpcError extends Error {
  constructor(
    readonly method: string,
    readonly payload: RpcErrorPayload,
    readonly stderrTail: string
  ) {
    super(payload.message || `${method} failed`)
    this.name = 'CodexRpcError'
  }
}

class CodexProcessError extends Error {
  constructor(message: string, readonly stderrTail: string) {
    super(message)
    this.name = 'CodexProcessError'
  }
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly lines: ReadlineInterface
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stderr = ''
  private closed = false
  private exited = false
  private exitCode: number | null = null
  private exitSignal: NodeJS.Signals | null = null
  private readonly spawnedAt = Date.now()
  private readonly exitWaiters = new Set<() => void>()
  private codexVersion: string | undefined

  constructor() {
    this.child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    this.lines = createInterface({ input: this.child.stdout })
    this.lines.on('line', (line) => this.handleLine(line))
    this.child.stderr.on('data', (chunk: Buffer | string) => this.appendStderr(chunk.toString('utf-8')))
    this.child.once('error', (error) => this.handleProcessError(error))
    this.child.once('exit', (code, signal) => this.handleExit(code, signal))
  }

  async initialize() {
    const response = await this.request<JsonObject>(
      'initialize',
      {
        clientInfo: {
          name: 'agentrig',
          title: 'AgentRig',
          version: packageJson.version,
        },
        capabilities: {
          experimentalApi: false,
        },
      },
      readTimeoutOverride('AGENTRIG_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS)
    )
    this.notify('initialized')
    this.codexVersion = readCodexVersionFromUserAgent(
      typeof response.userAgent === 'string' ? response.userAgent : undefined
    )
    if (!this.codexVersion || compareVersions(this.codexVersion, MIN_CODEX_VERSION) < 0) {
      throw new CodexTooOldError(this.codexVersion)
    }
  }

  async install(params: CodexInstallParams) {
    const response = await this.request<JsonObject>(
      'plugin/install',
      {
        marketplacePath: params.sourcePath,
        remoteMarketplaceName: null,
        pluginName: params.pluginName,
      },
      readTimeoutOverride('AGENTRIG_CODEX_APP_SERVER_INSTALL_TIMEOUT_MS', DEFAULT_INSTALL_TIMEOUT_MS)
    )

    if (!params.enable) {
      await this.request(
        'config/value/write',
        {
          keyPath: `plugins.${params.pluginName}@${params.marketplaceName}`,
          value: { enabled: false },
          mergeStrategy: 'upsert',
          filePath: null,
          expectedVersion: null,
        },
        readTimeoutOverride('AGENTRIG_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS)
      )
    }

    return {
      installPath: deriveCodexInstallPath(params.marketplaceName, params.pluginName, params.version),
      authPolicy: parseAuthPolicy(response.authPolicy),
      appsNeedingAuth: Array.isArray(response.appsNeedingAuth) ? response.appsNeedingAuth : [],
    }
  }

  async uninstall(params: { marketplaceName: string; pluginName: string }) {
    await this.request(
      'plugin/uninstall',
      {
        pluginId: `${params.pluginName}@${params.marketplaceName}`,
      },
      readTimeoutOverride('AGENTRIG_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS)
    )
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.lines.close()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('codex app-server client is closed'))
      this.pending.delete(id)
    }

    if (!this.exited && this.child.stdin.writable) {
      this.child.stdin.end()
    }
    if (await this.waitForExit(1_000)) return
    this.child.kill('SIGTERM')
    if (await this.waitForExit(500)) return
    this.child.kill('SIGKILL')
    await this.waitForExit(500)
  }

  private request<T = unknown>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('codex app-server client is closed'))
    }
    if (this.exited) {
      return Promise.reject(this.processExitError())
    }

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new CodexRpcTimeoutError(method, timeoutMs))
      }, timeoutMs)
      timeout.unref?.()
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })
      this.write({ id, method, params }).catch((error) => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  private notify(method: string, params?: unknown) {
    void this.write(params === undefined ? { method } : { method, params })
  }

  private async write(message: JsonObject) {
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private handleLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return

    let message: JsonObject
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      message = parsed as JsonObject
    } catch {
      return
    }

    if ('id' in message && 'method' in message) {
      void this.write({ id: message.id, result: {} })
      return
    }

    if (!('id' in message)) return
    const id = typeof message.id === 'number' ? message.id : Number(message.id)
    if (!Number.isFinite(id)) return
    const pending = this.pending.get(id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(id)
    if (message.error && typeof message.error === 'object' && !Array.isArray(message.error)) {
      pending.reject(new CodexRpcError(pending.method, message.error as RpcErrorPayload, this.stderrTail()))
      return
    }
    pending.resolve(message.result)
  }

  private appendStderr(chunk: string) {
    this.stderr = `${this.stderr}${chunk}`
    if (Buffer.byteLength(this.stderr, 'utf-8') > STDERR_BUFFER_BYTES) {
      this.stderr = this.stderr.slice(-STDERR_BUFFER_BYTES)
    }
  }

  private handleProcessError(error: NodeJS.ErrnoException) {
    const unavailable = error.code === 'ENOENT'
    const nextError = unavailable
      ? new CodexUnavailableError('Codex CLI is not installed or not on PATH.')
      : new CodexProcessError(error.message, this.stderrTail())
    this.rejectPending(nextError)
    if (unavailable) {
      this.exited = true
      this.resolveExitWaiters()
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null) {
    this.exited = true
    this.exitCode = code
    this.exitSignal = signal
    this.rejectPending(this.processExitError())
    this.resolveExitWaiters()
  }

  private processExitError() {
    const message = `codex app-server exited: code=${this.exitCode ?? 'null'} signal=${this.exitSignal ?? 'null'}`
    if (Date.now() - this.spawnedAt <= 500) {
      return new CodexUnavailableError(message)
    }
    return new CodexProcessError(message, this.stderrTail())
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private stderrTail() {
    return this.stderr.trim()
  }

  private waitForExit(timeoutMs: number) {
    if (this.exited) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.exitWaiters.delete(onExit)
        resolve(false)
      }, timeoutMs)
      const onExit = () => {
        clearTimeout(timeout)
        resolve(true)
      }
      this.exitWaiters.add(onExit)
    })
  }

  private resolveExitWaiters() {
    for (const waiter of this.exitWaiters) waiter()
    this.exitWaiters.clear()
  }
}

export async function codexInstallPlugin(params: CodexInstallParams): Promise<CodexInstallResult> {
  const client = new CodexAppServerClient()
  try {
    await client.initialize()
    const result = await client.install(params)
    return { ok: true, ...result }
  } catch (error) {
    return codexFailure(error)
  } finally {
    await client.close().catch(() => {})
  }
}

export async function codexUninstallPlugin(params: {
  marketplaceName: string
  pluginName: string
}): Promise<CodexUninstallResult> {
  const client = new CodexAppServerClient()
  try {
    await client.initialize()
    await client.uninstall(params)
    return { ok: true }
  } catch (error) {
    return codexFailure(error)
  } finally {
    await client.close().catch(() => {})
  }
}

function codexFailure(error: unknown): Exclude<CodexInstallResult, { ok: true }> {
  if (error instanceof CodexUnavailableError) {
    return { ok: false, reason: 'codex_not_installed', detail: error.message }
  }
  if (error instanceof CodexTooOldError) {
    return { ok: false, reason: 'codex_too_old', detail: error.message }
  }
  if (error instanceof CodexRpcTimeoutError) {
    return { ok: false, reason: 'timeout', detail: error.message }
  }
  if (error instanceof CodexRpcError) {
    return { ok: false, reason: 'rpc_error', detail: formatRpcError(error) }
  }
  if (error instanceof CodexProcessError) {
    return {
      ok: false,
      reason: 'rpc_error',
      detail: [error.message, error.stderrTail ? `stderr tail:\n${error.stderrTail}` : undefined]
        .filter(Boolean)
        .join('\n'),
    }
  }
  return {
    ok: false,
    reason: 'rpc_error',
    detail: error instanceof Error ? error.message : String(error),
  }
}

function formatRpcError(error: CodexRpcError) {
  const parts = [
    `${error.method} failed${typeof error.payload.code === 'number' ? ` (${error.payload.code})` : ''}: ${error.payload.message ?? 'RPC error'}`,
  ]
  if (error.payload.data !== undefined) {
    parts.push(`data: ${JSON.stringify(error.payload.data)}`)
  }
  if (error.stderrTail) {
    parts.push(`stderr tail:\n${error.stderrTail}`)
  }
  return parts.join('\n')
}

function parseAuthPolicy(value: unknown): 'ON_INSTALL' | 'ON_USE' {
  if (value === 'ON_INSTALL' || value === 'ON_USE') return value
  throw new CodexRpcError('plugin/install', { message: `Invalid plugin/install authPolicy: ${String(value)}` }, '')
}

function deriveCodexInstallPath(marketplaceName: string, pluginName: string, version: string) {
  return path.join(getCodexHome(), 'plugins', 'cache', marketplaceName, pluginName, version)
}

function getCodexHome() {
  const override = process.env.CODEX_HOME?.trim()
  return override ? path.resolve(override) : path.join(homedir(), '.codex')
}

function readCodexVersionFromUserAgent(userAgent: string | undefined) {
  const match = userAgent?.match(/^[^/\s]+\/(\d+\.\d+\.\d+(?:[-+][^\s()]*)?)/)
  return match?.[1]
}

function compareVersions(left: string, right: string) {
  const leftParts = numericVersionParts(left)
  const rightParts = numericVersionParts(right)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function numericVersionParts(version: string) {
  return version
    .split(/[+-]/, 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
}

function readTimeoutOverride(envName: string, fallback: number) {
  const raw = process.env[envName]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const __testing = {
  MIN_CODEX_VERSION,
  readCodexVersionFromUserAgent,
  compareVersions,
  deriveCodexInstallPath,
}
