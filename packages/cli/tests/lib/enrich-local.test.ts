import { describe, expect, it, vi } from 'vite-plus/test'
import { enrichWithLocalAi, extractJson } from '../../src/lib/enrich/local'
import type { EnrichmentPromptInput } from '@agentrig/sdk'

describe('local AI enrichment', () => {
  it('requires explicit local BYOK environment', async () => {
    await expect(
      enrichWithLocalAi({
        input: promptInput(),
        env: {},
        fetchImpl: vi.fn() as unknown as typeof fetch,
      })
    ).rejects.toThrow(/AGENTRIG_AI_BASE_URL/)
  })

  it('calls an OpenAI-compatible chat completions endpoint and validates the draft', async () => {
    let requestBody: unknown
    const rawFetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  description: 'Reusable repo review workflow.',
                  keywords: ['Review', 'typescript', 'review'],
                  suggestedPluginId: 'Community.Review',
                }),
              },
            },
          ],
        }),
        { status: 200 }
      )
    })
    const fetchImpl = rawFetchImpl as unknown as typeof fetch

    const draft = await enrichWithLocalAi({
      input: promptInput(),
      env: env(),
      fetchImpl,
    })

    expect(draft).toEqual({
      description: 'Reusable repo review workflow.',
      keywords: ['review', 'typescript'],
      suggestedPluginId: 'community.review',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://llm.example.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    )
    expect(requestBody).toMatchObject({
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    })
  })

  it('surfaces token-limit truncation from reasoning models', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: '',
              },
            },
          ],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch

    await expect(enrichWithLocalAi({ input: promptInput(), env: env(), fetchImpl })).rejects.toThrow(
      /Increase AGENTRIG_AI_MAX_TOKENS above 2000/
    )
  })

  it('retries without response_format when a compatible provider rejects JSON mode', async () => {
    const requestBodies: unknown[] = []
    const rawFetchImpl = vi
      .fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)))
        if (requestBodies.length === 1) {
          return new Response(JSON.stringify({ error: { message: 'response_format unsupported' } }), { status: 400 })
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"description":"Fallback"}' } }] }))
      })
    const fetchImpl = rawFetchImpl as unknown as typeof fetch

    await expect(enrichWithLocalAi({ input: promptInput(), env: env(), fetchImpl })).resolves.toEqual({
      description: 'Fallback',
    })

    const firstBody = requestBodies[0] as Record<string, unknown>
    const secondBody = requestBodies[1] as Record<string, unknown>
    expect(firstBody.response_format).toEqual({ type: 'json_object' })
    expect(secondBody.response_format).toBeUndefined()
  })

  it('retries once after malformed provider output', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"description":"Recovered"}' } }] }))
      ) as unknown as typeof fetch

    await expect(enrichWithLocalAi({ input: promptInput(), env: env(), fetchImpl })).resolves.toEqual({
      description: 'Recovered',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails closed when retry returns schema-invalid JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"keywords":["free"]}' } }] }))
      ) as unknown as typeof fetch

    await expect(enrichWithLocalAi({ input: promptInput(), env: env(), fetchImpl })).rejects.toThrow(
      /Local AI enrichment failed validation/
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('extracts fenced JSON without trusting prose', () => {
    expect(extractJson('```json\n{"description":"Ok"}\n```')).toEqual({ description: 'Ok' })
    expect(extractJson('Here: {"description":"Ok"}')).toEqual({ description: 'Ok' })
  })
})

function env() {
  return {
    AGENTRIG_AI_BASE_URL: 'https://llm.example.com/',
    AGENTRIG_AI_API_KEY: 'test-key',
    AGENTRIG_AI_MODEL: 'test-model',
  }
}

function promptInput(): EnrichmentPromptInput {
  return {
    repoName: 'owner/repo',
    topLevelPaths: ['skills', 'README.md'],
    fieldsToFill: ['description', 'keywords', 'suggestedPluginId'],
    signals: [
      {
        kind: 'skill',
        id: 'review',
        title: 'Review',
        sourcePath: 'skills/review',
        providerCompat: {
          claude: 'native',
          codex: 'native',
          cursor: 'native',
        },
      },
    ],
  }
}
