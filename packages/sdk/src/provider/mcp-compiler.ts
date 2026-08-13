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
    command: compileExecutable(server.command, options),
    ...(server.args ? { args: server.args.map((value) => expandPortablePaths(value, options)) } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(server.cwd ? { cwd: compileWorkingDirectory(server.cwd, options) } : {}),
  }
}

function compileExecutable(command: string, options: CompileAgentPluginMcpOptions) {
  const expanded = expandPortablePaths(command, options)
  return expanded.startsWith('./') ? joinPluginPath(options.pluginRoot, expanded.slice(2)) : expanded
}

function compileWorkingDirectory(cwd: string, options: CompileAgentPluginMcpOptions) {
  const expanded = expandPortablePaths(cwd, options)
  if (expanded.startsWith('./')) return joinPluginPath(options.pluginRoot, expanded.slice(2))
  if (!expanded.startsWith('/') && !expanded.startsWith('${')) return joinPluginPath(options.pluginRoot, expanded)
  return expanded
}

function joinPluginPath(root: string, relative: string) {
  return `${root.replace(/\/+$/g, '')}/${relative.replace(/^\/+/, '')}`
}

function expandPortablePaths(value: string, options: CompileAgentPluginMcpOptions) {
  return value
    .replaceAll('${PLUGIN_ROOT}', options.pluginRoot)
    .replaceAll('${PLUGIN_DATA}', options.pluginData)
}
