import { describe, expect, it } from 'vitest'
import { compileAgentPluginMcpServers } from './mcp-compiler'

describe('compileAgentPluginMcpServers', () => {
  it('translates portable remote transports to each provider vocabulary', () => {
    const servers = [
      { name: 'docs', server: { type: 'streamable-http' as const, url: 'https://example.com/mcp' } },
      { name: 'events', server: { type: 'sse' as const, url: 'https://example.com/sse' } },
    ]

    expect(compileAgentPluginMcpServers(servers, {
      provider: 'claude',
      pluginRoot: '/plugin',
      pluginData: '/data',
    })).toEqual({
      mcpServers: {
        docs: { type: 'http', url: 'https://example.com/mcp' },
        events: { type: 'sse', url: 'https://example.com/sse' },
      },
    })
    expect(compileAgentPluginMcpServers(servers, {
      provider: 'codex',
      pluginRoot: '/plugin',
      pluginData: '/data',
    })).toEqual({
      mcpServers: {
        docs: { type: 'streamable-http', url: 'https://example.com/mcp' },
        events: { type: 'sse', url: 'https://example.com/sse' },
      },
    })
  })
})
