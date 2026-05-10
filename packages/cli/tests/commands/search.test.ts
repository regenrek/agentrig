import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import searchCommand, { formatSearchHit } from '../../src/commands/search'
import { loadConfig } from '../../src/lib/config'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))

const fetchMock = vi.fn()
const originalFetch = globalThis.fetch

describe('command:search', () => {
  const runSearch = searchCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [{ name: 'agentrig', url: 'https://agentrig.test' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    } as any)
    fetchMock.mockReset()
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    })
  })

  it('formats slug, version, kind, name, and score in one line per hit', () => {
    expect(
      formatSearchHit({
        slug: 'regenrek-agent-skills',
        artifactId: 'regenrek.agent-skills',
        kind: 'skill',
        origin: 'bundled',
        displayName: 'Agent skills',
        version: '0.1.0',
        score: 0.875,
      }),
    ).toBe('regenrek-agent-skills  v0.1.0  [skill]  Agent skills  (0.875)')
  })

  it('hits the configured marketplace search endpoint with q + limit + kind', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          results: [
            {
              slug: 'demo-plugin',
              artifactId: 'demo.plugin',
              kind: 'plugin',
              origin: 'standalone',
              displayName: 'Demo',
              version: '1.0.0',
              score: 1,
            },
          ],
        }),
    })

    await runSearch({ args: { query: 'demo', cwd: '/repo', limit: '5', kind: 'plugin' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchMock.mock.calls[0]?.[0])
    expect(calledUrl).toContain('https://agentrig.test/api/cli/search')
    expect(calledUrl).toContain('q=demo')
    expect(calledUrl).toContain('limit=5')
    expect(calledUrl).toContain('kind=plugin')
  })

  it('refuses unknown --kind values without hitting the network', async () => {
    await expect(runSearch({ args: { query: 'demo', cwd: '/repo', kind: 'banana' } })).rejects.toThrow(/Invalid --kind/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when the search endpoint returns a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'upstream down',
    })
    await expect(runSearch({ args: { query: 'demo', cwd: '/repo' } })).rejects.toThrow(/Search failed \(502\)/)
  })
})
