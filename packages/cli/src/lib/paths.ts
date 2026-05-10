import { homedir } from 'node:os'
import path from 'node:path'

export function getAgentRigHome() {
  const override = process.env.AGENTRIG_HOME?.trim()
  return override ? path.resolve(override) : homedir()
}

export function getAgentRigDataDir() {
  return path.join(getAgentRigHome(), '.agentrig')
}

export function getAgentRigCacheDir() {
  return path.join(getAgentRigDataDir(), 'cache')
}

export function getClaudeMarketplaceCacheRoot(marketplaceName: string) {
  return path.join(getAgentRigCacheDir(), 'claude-marketplaces', marketplaceName)
}

export function getCodexMarketplaceCacheRoot(marketplaceName: string) {
  return path.join(getAgentRigCacheDir(), 'codex-marketplaces', marketplaceName)
}
