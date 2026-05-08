import { homedir } from 'node:os'
import path from 'node:path'

export function getAgentRigHome() {
  const override = process.env.AGENTRIG_HOME?.trim()
  return override ? path.resolve(override) : homedir()
}
