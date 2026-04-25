import { buildEnrichmentPrompt, validateEnrichmentDraft, type AiEnrichmentDraft, type EnrichmentPromptInput } from '@agentrig/sdk'

export type LocalAiEnrichmentOptions = {
  input: EnrichmentPromptInput
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
    }
  }>
  model?: string
  usage?: {
    completion_tokens?: number
  }
}

const REQUIRED_ENV = ['AGENTRIG_AI_BASE_URL', 'AGENTRIG_AI_API_KEY', 'AGENTRIG_AI_MODEL'] as const
const DEFAULT_MAX_TOKENS = 2000

export async function enrichWithLocalAi(options: LocalAiEnrichmentOptions): Promise<AiEnrichmentDraft> {
  const env = options.env ?? process.env
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim())
  if (missing.length) {
    throw new Error(
      `Missing local AI environment variables: ${missing.join(', ')}. Run without --enrich-ai for deterministic mode, or set AGENTRIG_AI_BASE_URL, AGENTRIG_AI_API_KEY, and AGENTRIG_AI_MODEL.`
    )
  }

  const prompt = buildEnrichmentPrompt(options.input)
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = env.AGENTRIG_AI_BASE_URL!.replace(/\/+$/, '')
  const timeoutMs = parsePositiveInt(env.AGENTRIG_AI_TIMEOUT_MS, 30_000)
  const maxTokens = parsePositiveInt(env.AGENTRIG_AI_MAX_TOKENS, DEFAULT_MAX_TOKENS)

  let lastReason = 'Invalid local AI response'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await requestChatCompletion(fetchImpl, {
      url: `${baseUrl}/chat/completions`,
      apiKey: env.AGENTRIG_AI_API_KEY!,
      model: env.AGENTRIG_AI_MODEL!,
      timeoutMs,
      maxTokens,
      system: prompt.system,
      user: attempt === 0 ? prompt.user : `${prompt.user}\n\nPrevious response was invalid JSON. Return only valid JSON.`,
    })
    const extracted = safeExtractJson(raw)
    if (!extracted.ok) {
      lastReason = extracted.reason
      continue
    }
    const parsed = validateEnrichmentDraft(extracted.value)
    if (parsed.ok) return parsed.draft
    lastReason = parsed.reason
  }
  throw new Error(`Local AI enrichment failed validation: ${lastReason}`)
}

function safeExtractJson(content: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: extractJson(content) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Local AI response did not contain JSON' }
  }
}

async function requestChatCompletion(
  fetchImpl: typeof fetch,
  request: {
    url: string
    apiKey: string
    model: string
    timeoutMs: number
    maxTokens: number
    system: string
    user: string
  }
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
  try {
    let response = await postChatCompletion(fetchImpl, request, controller.signal, true)
    if (!response.ok && canRetryWithoutResponseFormat(response.status)) {
      response = await postChatCompletion(fetchImpl, request, controller.signal, false)
    }
    if (!response.ok) {
      throw new Error(`Local AI provider returned HTTP ${response.status}`)
    }
    const body = (await response.json()) as ChatCompletionResponse
    const choice = body.choices?.[0]
    const content = choice?.message?.content
    if (!content && choice?.finish_reason === 'length') {
      throw new Error(
        `Local AI provider returned an empty response after hitting the max token limit. Increase AGENTRIG_AI_MAX_TOKENS above ${request.maxTokens}.`
      )
    }
    if (!content) throw new Error('Local AI provider returned an empty response')
    return content
  } finally {
    clearTimeout(timeout)
  }
}

async function postChatCompletion(
  fetchImpl: typeof fetch,
  request: {
    url: string
    apiKey: string
    model: string
    maxTokens: number
    system: string
    user: string
  },
  signal: AbortSignal,
  includeResponseFormat: boolean
) {
  return await fetchImpl(request.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      max_tokens: request.maxTokens,
      temperature: 0.2,
      ...(includeResponseFormat ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
}

function canRetryWithoutResponseFormat(status: number) {
  return status === 400 || status === 422
}

export function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced?.[1] ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error('Local AI response did not contain JSON')
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
