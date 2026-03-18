import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      skillsDir: '.codex/skills',
      registries: [{ name: 'shared', url: 'https://global/{name}.json' }],
      namespacedRegistries: {
        '@acme': { url: 'https://global/{name}.json' },
      },
      rigs: { base: { packs: ['core'] } },
      defaultRig: 'base',
      $schema: 'schema:global',
    }
    const projectCfg: AgentRigConfig = {
      skillsDir: '.custom/skills',
      registries: [
        { name: 'shared', url: 'https://project/{name}.json' },
        { name: 'extra', url: 'https://extra/{name}.json' },
      ],
      namespacedRegistries: {
        '@acme': { url: 'https://project/{name}.json' },
      },
      rigs: { extra: { packs: ['extra'] } },
      defaultRig: 'extra',
      $schema: 'schema:project',
    }

    vi.mocked(readJsonFile)
      .mockResolvedValueOnce(globalCfg)
      .mockResolvedValueOnce(projectCfg)

    const cfg = await loadConfig('/repo')

    expect(cfg.skillsDir).toBe('.custom/skills')
    expect(cfg.registries).toEqual([
      { name: 'shared', url: 'https://project/{name}.json' },
      { name: 'extra', url: 'https://extra/{name}.json' },
    ])
    expect(cfg.namespacedRegistries).toEqual({
      '@acme': { url: 'https://project/{name}.json' },
    })
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

  it('uses default skillsDir when configs are empty', async () => {
    vi.mocked(readJsonFile).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const cfg = await loadConfig('/repo')
    expect(cfg.skillsDir).toBe('.codex/skills')
    expect(cfg.registries).toEqual([])
    expect(cfg.namespacedRegistries).toBeUndefined()
    expect(cfg.rigs).toEqual({})
  })

  it('writes project config to expected path', async () => {
    const cfg: AgentRigConfig = { skillsDir: '.codex/skills' }
    await writeProjectConfig('/repo', cfg)
    expect(writeJsonFile).toHaveBeenCalledWith('/repo/agentrig.config.json', cfg)
  })

  it('writes global config and ensures directory exists', async () => {
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue('/home/tester')
    const cfg: AgentRigConfig = { skillsDir: '.codex/skills' }
    await writeGlobalConfig(cfg)
    expect(ensureDir).toHaveBeenCalledWith('/home/tester/.agentrig')
    expect(writeJsonFile).toHaveBeenCalledWith('/home/tester/.agentrig/config.json', cfg)
    homedirSpy.mockRestore()
  })
})
