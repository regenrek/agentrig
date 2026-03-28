import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import process from 'node:process'

export type LoggedRequest = {
  method: string
  pathname: string
  search: string
  headers: IncomingMessage['headers']
  body: Buffer
}

export type FixtureResponse = {
  status?: number
  headers?: Record<string, string>
  body?: string | Uint8Array | Buffer | Record<string, unknown> | Array<unknown> | null
}

export type FixtureRoute = {
  method?: string
  pathname: string | RegExp
  handler: (
    request: LoggedRequest,
    match: RegExpMatchArray | null
  ) => Promise<FixtureResponse | undefined> | FixtureResponse | undefined
}

export type FixtureServer = {
  baseUrl: string
  requests: LoggedRequest[]
  url: (pathname: string) => string
  clearRequests: () => void
  close: () => Promise<void>
}

function getContentType(filePath: string) {
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (filePath.endsWith('.txt')) return 'text/plain; charset=utf-8'
  if (filePath.endsWith('.sh')) return 'text/x-shellscript; charset=utf-8'
  return 'application/octet-stream'
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function writeResponse(response: ServerResponse, fixture: FixtureResponse) {
  const status = fixture.status ?? 200
  const headers = { ...(fixture.headers ?? {}) }
  const body = fixture.body

  if (body == null) {
    response.writeHead(status, headers)
    response.end()
    return
  }

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    response.writeHead(status, headers)
    response.end(body)
    return
  }

  if (typeof body === 'string') {
    if (!headers['content-type']) {
      headers['content-type'] = 'text/plain; charset=utf-8'
    }
    response.writeHead(status, headers)
    response.end(body)
    return
  }

  headers['content-type'] ??= 'application/json'
  response.writeHead(status, headers)
  response.end(JSON.stringify(body))
}

export async function startFixtureServer(options: {
  staticRoot?: string
  routes?: FixtureRoute[]
} = {}): Promise<FixtureServer> {
  const requests: LoggedRequest[] = []
  const staticRoot = options.staticRoot ? path.resolve(options.staticRoot) : undefined
  const routes = options.routes ?? []

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET'
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const body = await readBody(request)
      const loggedRequest: LoggedRequest = {
        method,
        pathname: url.pathname,
        search: url.search,
        headers: request.headers,
        body,
      }
      requests.push(loggedRequest)

      for (const route of routes) {
        if (route.method && route.method !== method) continue
        const match =
          typeof route.pathname === 'string'
            ? route.pathname === url.pathname
              ? null
              : null
            : url.pathname.match(route.pathname)
        const matches =
          typeof route.pathname === 'string' ? route.pathname === url.pathname : Boolean(match)
        if (!matches) continue

        const result = await route.handler(loggedRequest, match)
        if (result) {
          writeResponse(response, result)
          return
        }
      }

      if (staticRoot) {
        const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
        const filePath = path.resolve(staticRoot, relativePath)
        const relativeToRoot = path.relative(staticRoot, filePath)
        if (
          !relativeToRoot.startsWith('..') &&
          !path.isAbsolute(relativeToRoot)
        ) {
          try {
            const stat = await fs.stat(filePath)
            if (stat.isFile()) {
              writeResponse(response, {
                headers: { 'content-type': getContentType(filePath) },
                body: await fs.readFile(filePath),
              })
              return
            }
          } catch {
            // fall through to 404
          }
        }
      }

      writeResponse(response, {
        status: 404,
        body: { message: `No fixture route for ${method} ${url.pathname}` },
      })
    } catch (error) {
      writeResponse(response, {
        status: 500,
        body: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine fixture server address')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    requests,
    url(pathname) {
      return new URL(pathname, `${baseUrl}/`).toString()
    },
    clearRequests() {
      requests.length = 0
    },
    async close() {
      server.close()
      await once(server, 'close')
    },
  }
}

export async function createNodeBackedCommand(
  binDir: string,
  name: string,
  moduleSource: string
) {
  await fs.mkdir(binDir, { recursive: true })
  const modulePath = path.join(binDir, `${name}.mjs`)
  const unixPath = path.join(binDir, name)
  const windowsPath = path.join(binDir, `${name}.cmd`)

  await fs.writeFile(modulePath, moduleSource, 'utf-8')
  await fs.writeFile(
    unixPath,
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)',
      `exec node "$DIR/${name}.mjs" "$@"`,
      '',
    ].join('\n'),
    'utf-8'
  )
  await fs.writeFile(
    windowsPath,
    `@echo off\r\nnode "%~dp0\\${name}.mjs" %*\r\n`,
    'utf-8'
  )
  await fs.chmod(unixPath, 0o755)
  await fs.chmod(modulePath, 0o755)
  return { modulePath, unixPath, windowsPath }
}

export function withPrependedBinPath(
  binDir: string,
  env: NodeJS.ProcessEnv = {}
) {
  const existingPath = env.PATH ?? process.env.PATH ?? ''
  return {
    ...env,
    PATH: [binDir, existingPath].filter(Boolean).join(path.delimiter),
  }
}

export async function readJsonLinesFile<T>(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf-8')
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}
