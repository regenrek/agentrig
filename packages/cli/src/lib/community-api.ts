import type {
  CliLoginExchange,
  CliLoginStart,
  CliWhoAmI,
  PluginSubmissionListResponse,
  PluginSubmissionCreateResponse,
  PluginSubmissionStatus,
} from './types'

const DEFAULT_COMMUNITY_BASE_URL = 'https://agentrig.ai'
const DEFAULT_FETCH_TIMEOUT_MS = 15000
const DEFAULT_MAX_RETRIES = 1
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])

type JsonPrimitive = boolean | number | string | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type PublishShape =
  | { kind: 'plugin_all' }
  | { kind: 'plugin_selected'; selectors: string[] }
  | { kind: 'standalone_artifacts'; selectors: string[] }
  | { kind: 'discovery_only'; selectors?: string[] }

export class CommunityApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CommunityApiError'
    this.status = status
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: JsonValue
  accessToken?: string
  timeoutMs?: number
  maxRetries?: number
}

function normalizeBaseUrl(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid AgentRig base URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid AgentRig base URL protocol: ${url.protocol}`)
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readErrorMessage(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await response.json()) as Record<string, unknown>
    const message = body.message
    return typeof message === 'string' && message.trim()
      ? message.trim()
      : `Request failed (${response.status})`
  }
  const text = await response.text()
  return text.trim() || `Request failed (${response.status})`
}

async function request<T>(baseUrl: string, pathname: string, options: RequestOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...options.headers,
  }

  let body: string | undefined
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  if (options.accessToken) {
    headers.authorization = `Bearer ${options.accessToken}`
  }

  const url = new URL(pathname, `${baseUrl}/`).toString()

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: options.method ?? 'GET',
          headers,
          body,
        },
        timeoutMs
      )

      if (response.ok) {
        if (response.status === 204) return undefined as T
        return (await response.json()) as T
      }

      const message = await readErrorMessage(response)
      if (!RETRY_STATUSES.has(response.status) || attempt === maxRetries) {
        throw new CommunityApiError(message, response.status)
      }
    } catch (error) {
      if (error instanceof CommunityApiError) throw error
      if (attempt === maxRetries) throw error
    }
    const delayMs = 250 * 2 ** (attempt + 1)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  throw new Error(`Request failed for ${url}`)
}

export function resolveCommunityBaseUrl(
  explicitBaseUrl?: string,
  storedBaseUrl?: string
) {
  const baseUrl = explicitBaseUrl ?? process.env.AGENTRIG_BASE_URL ?? storedBaseUrl ?? DEFAULT_COMMUNITY_BASE_URL
  return normalizeBaseUrl(baseUrl)
}

export async function startCliLogin(baseUrl: string) {
  return await request<CliLoginStart>(baseUrl, '/api/cli/auth/start', {
    method: 'POST',
  })
}

export async function exchangeCliLogin(
  baseUrl: string,
  requestId: string,
  exchangeSecret: string
) {
  return await request<CliLoginExchange>(baseUrl, '/api/cli/auth/exchange', {
    method: 'POST',
    body: { requestId, exchangeSecret },
    maxRetries: 0,
  })
}

export async function whoAmI(baseUrl: string, accessToken: string) {
  return await request<CliWhoAmI>(baseUrl, '/api/cli/whoami', {
    accessToken,
    maxRetries: 0,
  })
}

export async function logout(baseUrl: string, accessToken: string) {
  await request<void>(baseUrl, '/api/cli/auth/logout', {
    method: 'POST',
    accessToken,
    maxRetries: 0,
  })
}

export async function createPluginSubmission(
  baseUrl: string,
  accessToken: string,
  payload: {
    upstream_repo: string
    upstream_tag: string
    upstream_commit_sha: string
    plugin_path: string
  }
) {
  const result = await request<PluginSubmissionCreateResponse>(baseUrl, '/api/cli/plugins/submissions', {
    method: 'POST',
    accessToken,
    body: payload,
    maxRetries: 0,
  })
  return result
}

export async function mintPublishToken(
  baseUrl: string,
  payload: {
    artifactKind: 'plugin' | 'skill' | 'mcp' | 'hook'
    artifactId: string
    version?: string
    publishShape: PublishShape
    scanDigest?: string
    commitSha?: string
    githubOidcToken: string
  }
) {
  return await request<{ token: string; expiresAt: number }>(baseUrl, '/api/cli/publish-token/mint', {
    method: 'POST',
    body: payload,
    maxRetries: 0,
  })
}

export async function getPluginSubmissionStatus(
  baseUrl: string,
  accessToken: string,
  submissionId: string
) {
  return await request<PluginSubmissionStatus>(
    baseUrl,
    `/api/cli/plugins/submissions/${encodeURIComponent(submissionId)}`,
    {
      accessToken,
      maxRetries: 0,
    }
  )
}

export async function listPluginSubmissions(
  baseUrl: string,
  accessToken: string,
  limit = 20
) {
  const response = await request<PluginSubmissionListResponse>(
    baseUrl,
    `/api/cli/plugins/submissions?limit=${encodeURIComponent(String(limit))}`,
    {
      accessToken,
      maxRetries: 0,
    }
  )
  return response.submissions
}
