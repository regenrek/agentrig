import os from 'node:os'
import path from 'node:path'
import { readJsonFile, writeJsonFile, ensureDir } from './fs'
import type { AgentRigConfig, RegistryRef, RigDefinition, NamespacedRegistryConfig } from './types'

export type ResolvedConfig = Required<Pick<AgentRigConfig, 'skillsDir'>> &
  Pick<AgentRigConfig, '$schema' | 'defaultRig'> & {
    registries: RegistryRef[]
    namespacedRegistries?: Record<string, NamespacedRegistryConfig>
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

function mergeNamespacedRegistries(
  globalRegs?: Record<string, NamespacedRegistryConfig>,
  projectRegs?: Record<string, NamespacedRegistryConfig>
): Record<string, NamespacedRegistryConfig> | undefined {
  if (!globalRegs && !projectRegs) return undefined
  return { ...(globalRegs ?? {}), ...(projectRegs ?? {}) }
}

export function getGlobalConfigPath() {
  return path.join(os.homedir(), '.agentrig', 'config.json')
}

export function getProjectConfigPath(cwd: string) {
  return path.join(cwd, 'agentrig.config.json')
}

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const globalConfigPath = getGlobalConfigPath()
  const projectConfigPath = getProjectConfigPath(cwd)

  const globalCfg = (await readJsonFile<AgentRigConfig>(globalConfigPath)) ?? {}
  const projectCfg = (await readJsonFile<AgentRigConfig>(projectConfigPath)) ?? {}

  const skillsDir = projectCfg.skillsDir ?? globalCfg.skillsDir ?? '.codex/skills'
  const registries = mergeRegistries(globalCfg.registries ?? [], projectCfg.registries ?? [])
  const namespacedRegistries = mergeNamespacedRegistries(
    globalCfg.namespacedRegistries,
    projectCfg.namespacedRegistries
  )
  const rigs = { ...(globalCfg.rigs ?? {}), ...(projectCfg.rigs ?? {}) }
  const defaultRig = projectCfg.defaultRig ?? globalCfg.defaultRig

  return {
    $schema: projectCfg.$schema ?? globalCfg.$schema,
    skillsDir,
    registries,
    namespacedRegistries,
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
