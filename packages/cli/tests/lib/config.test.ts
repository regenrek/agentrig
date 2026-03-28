import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AgentRigConfig } from '../../src/lib/types'
import {
  getGlobalAgentRigDir,
  getGlobalAuthPath,
  getGlobalConfigPath,
  getProjectConfigPath,
  loadConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from '../../src/lib/config'
import { ensureDir, readJsonFile, writeJsonFile } from '../../src/lib/fs'

vi.mock('../../src/lib/fs', () => ({
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  ensureDir: vi.fn(),
}))

describe('config', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('builds config paths', () => {
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue('/home/tester')
    expect(getGlobalAgentRigDir()).toBe('/home/tester/.agentrig')
    expect(getGlobalConfigPath()).toBe('/home/tester/.agentrig/config.json')
    expect(getGlobalAuthPath()).toBe('/home/tester/.agentrig/auth.json')
    expect(getProjectConfigPath('/repo')).toBe('/repo/agentrig.config.json')
    homedirSpy.mockRestore()
  })

  it('merges global and project config with defaults', async () => {
    const globalCfg: AgentRigConfig = {
      registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }],
      rigs: { base: { packs: ['core'] } },
      defaultRig: 'base',
      $schema: 'schema:global',
    }
    const projectCfg: AgentRigConfig = {
      registries: [
        { name: 'official', url: 'https://agentrig.ai/registry' },
        { name: 'georg', url: 'https://georg.dev/agentrig' },
      ],
      rigs: { extra: { packs: ['extra'] } },
      defaultRig: 'extra',
      $schema: 'schema:project',
    }

    vi.mocked(readJsonFile)
      .mockResolvedValueOnce(globalCfg)
      .mockResolvedValueOnce(projectCfg)

    const cfg = await loadConfig('/repo')

    expect(cfg.registries).toEqual([
      { name: 'official', url: 'https://agentrig.ai/registry' },
      { name: 'georg', url: 'https://georg.dev/agentrig' },
    ])
    expect(cfg.rigs).toEqual({
      base: { packs: ['core'] },
      extra: { packs: ['extra'] },
    })
    expect(cfg.defaultRig).toBe('extra')
    expect(cfg.$schema).toBe('schema:project')
    expect(cfg.paths).toEqual({
      projectConfigPath: path.join('/repo', 'agentrig.config.json'),
      globalConfigPath: path.join(os.homedir(), '.agentrig', 'config.json'),
    })
  })

  it('uses empty registry and rig defaults when configs are empty', async () => {
    vi.mocked(readJsonFile).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const cfg = await loadConfig('/repo')
    expect(cfg.registries).toEqual([])
    expect(cfg.rigs).toEqual({})
    expect(cfg.defaultRig).toBeUndefined()
  })

  it('writes project config to expected path', async () => {
    const cfg: AgentRigConfig = { registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }] }
    await writeProjectConfig('/repo', cfg)
    expect(writeJsonFile).toHaveBeenCalledWith('/repo/agentrig.config.json', cfg)
  })

  it('writes global config and ensures directory exists', async () => {
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue('/home/tester')
    const cfg: AgentRigConfig = { registries: [{ name: 'official', url: 'https://agentrig.ai/registry' }] }
    await writeGlobalConfig(cfg)
    expect(ensureDir).toHaveBeenCalledWith('/home/tester/.agentrig')
    expect(writeJsonFile).toHaveBeenCalledWith('/home/tester/.agentrig/config.json', cfg)
    homedirSpy.mockRestore()
  })
})
