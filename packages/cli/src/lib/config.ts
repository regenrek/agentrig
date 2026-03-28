import os from 'node:os'
import path from 'node:path'
import { readJsonFile, writeJsonFile, ensureDir } from './fs'
import type { AgentRigConfig, RegistryRef, RigDefinition } from './types'

export type ResolvedConfig = Pick<AgentRigConfig, '$schema' | 'defaultRig'> & {
  registries: RegistryRef[]
  rigs: Record<string, RigDefinition>
  paths: {
    projectConfigPath: string
    globalConfigPath: string
  }
}

function mergeRegistries(globalRegs: RegistryRef[], projectRegs: RegistryRef[]) {
  const map = new Map<string, RegistryRef>()
  for (const r of globalRegs) map.set(r.name, r)
  for (const r of projectRegs) map.set(r.name, r)
  return [...map.values()]
}

export function getGlobalAgentRigDir() {
  return path.join(os.homedir(), '.agentrig')
}

export function getGlobalConfigPath() {
  return path.join(getGlobalAgentRigDir(), 'config.json')
}

export function getGlobalAuthPath() {
  return path.join(getGlobalAgentRigDir(), 'auth.json')
}

export function getProjectConfigPath(cwd: string) {
  return path.join(cwd, 'agentrig.config.json')
}

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const globalConfigPath = getGlobalConfigPath()
  const projectConfigPath = getProjectConfigPath(cwd)

  const globalCfg = (await readJsonFile<AgentRigConfig>(globalConfigPath)) ?? {}
  const projectCfg = (await readJsonFile<AgentRigConfig>(projectConfigPath)) ?? {}

  const registries = mergeRegistries(globalCfg.registries ?? [], projectCfg.registries ?? [])
  const rigs = { ...(globalCfg.rigs ?? {}), ...(projectCfg.rigs ?? {}) }
  const defaultRig = projectCfg.defaultRig ?? globalCfg.defaultRig

  return {
    $schema: projectCfg.$schema ?? globalCfg.$schema,
    registries,
    rigs,
    defaultRig,
    paths: { projectConfigPath, globalConfigPath },
  }
}

export async function writeProjectConfig(cwd: string, cfg: AgentRigConfig) {
  const projectConfigPath = getProjectConfigPath(cwd)
  await writeJsonFile(projectConfigPath, cfg)
}

export async function writeGlobalConfig(cfg: AgentRigConfig) {
  const p = getGlobalConfigPath()
  await ensureDir(path.dirname(p))
  await writeJsonFile(p, cfg)
}
