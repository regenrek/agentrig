import type { AgentPluginMcpServer } from '../agent-plugins'

export type AgentPluginMcpComponent = { name: string; server: AgentPluginMcpServer }
export type AgentPluginMcpProvider = 'claude' | 'codex' | 'cursor'

export type CompileAgentPluginMcpOptions = {
  provider: AgentPluginMcpProvider
  pluginRoot: string
  pluginData: string
  injectedEnv?: Record<string, string>
}

export function compileAgentPluginMcpServers(
  servers: readonly AgentPluginMcpComponent[],
  options: CompileAgentPluginMcpOptions,
) {
  return {
    mcpServers: Object.fromEntries(
      [...servers]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(({ name, server }) => [name, compileServer(server, options)]),
    ),
  }
}

function compileServer(server: AgentPluginMcpServer, options: CompileAgentPluginMcpOptions) {
  if (server.type !== 'stdio') {
    return {
      ...server,
      ...((options.provider === 'claude' || options.provider === 'cursor') && server.type === 'streamable-http'
        ? { type: 'http' as const }
        : {}),
    }
  }
  const env = {
    ...Object.fromEntries(
      Object.entries(server.env ?? {}).map(([name, value]) => [name, expandPortablePaths(value, options)]),
    ),
    ...options.injectedEnv,
  }
  return {
    ...(options.provider === 'claude' ? {} : { type: 'stdio' as const }),
    command: server.command,
    ...(server.args ? { args: server.args.map((value) => expandPortablePaths(value, options)) } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(server.cwd ? { cwd: expandPortablePaths(server.cwd, options) } : {}),
  }
}

function expandPortablePaths(value: string, options: CompileAgentPluginMcpOptions) {
  return value
    .replaceAll('${PLUGIN_ROOT}', options.pluginRoot)
    .replaceAll('${PLUGIN_DATA}', options.pluginData)
}
