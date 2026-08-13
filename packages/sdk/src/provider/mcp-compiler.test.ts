import { describe, expect, it } from 'vitest'
import { compileAgentPluginMcpServers } from './mcp-compiler'

describe('compileAgentPluginMcpServers', () => {
  it('resolves executable paths without inventing an omitted working directory', () => {
    const compiled = compileAgentPluginMcpServers([
      {
        name: 'local',
        server: {
          type: 'stdio',
          command: './scripts/server.mjs',
          args: ['--config', '${PLUGIN_ROOT}/config.json'],
          env: { DATA: '${PLUGIN_DATA}/cache' },
        },
      },
    ], {
      provider: 'cursor',
      pluginRoot: '/plugins/local',
      pluginData: '/data/local',
    })

    expect(compiled).toEqual({
      mcpServers: {
        local: {
          type: 'stdio',
          command: '/plugins/local/scripts/server.mjs',
          args: ['--config', '/plugins/local/config.json'],
          env: { DATA: '/data/local/cache' },
        },
      },
    })
  })

  it('resolves an explicitly declared working directory against the plugin root', () => {
    const compiled = compileAgentPluginMcpServers([{
      name: 'local',
      server: { type: 'stdio', command: 'node', cwd: './runtime' },
    }], {
      provider: 'codex',
      pluginRoot: '/plugins/local',
      pluginData: '/data/local',
    })

    expect(compiled.mcpServers.local).toMatchObject({ cwd: '/plugins/local/runtime' })
  })

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
    expect(compileAgentPluginMcpServers(servers, {
      provider: 'cursor',
      pluginRoot: '/plugin',
      pluginData: '/data',
    })).toEqual({
      mcpServers: {
        docs: { type: 'http', url: 'https://example.com/mcp' },
        events: { type: 'sse', url: 'https://example.com/sse' },
      },
    })
  })
})
