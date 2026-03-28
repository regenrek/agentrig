import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import rigCommand from '../../src/commands/rig'
import listCommand from '../../src/commands/rig/list'
import applyCommand from '../../src/commands/rig/apply'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import { loadManifest, saveManifest } from '../../src/lib/manifest'
import { installPack, removePack } from '../../src/lib/install'
import type { Manifest } from '../../src/lib/types'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/manifest', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
}))
vi.mock('../../src/lib/install', () => ({
  installPack: vi.fn(),
  removePack: vi.fn(),
}))

describe('command:rig', () => {
  const runRig = rigCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const runList = listCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const runApply = applyCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('shows usage for rig wrapper', async () => {
    await runRig({ args: { help: false } })
  })

  it('lists rigs from config', async () => {
    const cfg: ResolvedConfig = {
      skillsDir: '.codex/skills',
      registries: [],
      rigs: {
        core: { packs: ['core'] },
        extra: { extends: ['core'], packs: ['extra'] },
      },
      defaultRig: 'core',
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)

    await runList({ args: { cwd: '/repo', help: false } })
    expect(loadConfig).toHaveBeenCalledWith('/repo')
  })

  it('applies rigs and prunes packs', async () => {
    const cfg: ResolvedConfig = {
      skillsDir: '.codex/skills',
      registries: [],
      rigs: {
        base: { packs: ['core'] },
        extra: { extends: ['base'], packs: ['extra', 'core'] },
      },
      defaultRig: 'extra',
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    const manifest: Manifest = {
      schemaVersion: 1,
      installed: {
        old: {
          name: 'old',
          version: '1.0.0',
          source: 'registry:default',
          installedAt: '',
          files: [],
        },
      },
    }

    vi.mocked(loadConfig).mockResolvedValue(cfg)
    vi.mocked(loadManifest).mockResolvedValue(manifest)
    vi.mocked(installPack).mockResolvedValue({ installed: ['x'], skipped: [] })
    vi.mocked(removePack).mockResolvedValue({ removed: ['x'], kept: [], missing: [] })

    await runApply({
      args: {
        cwd: '/repo',
        force: false,
        prune: true,
        help: false,
      },
    })

    expect(installPack).toHaveBeenNthCalledWith(
      1,
      'core',
      cfg,
      manifest,
      expect.objectContaining({ cwd: '/repo', skillsDir: '.codex/skills' })
    )
    expect(installPack).toHaveBeenNthCalledWith(
      2,
      'extra',
      cfg,
      manifest,
      expect.objectContaining({ cwd: '/repo', skillsDir: '.codex/skills' })
    )
    expect(removePack).toHaveBeenCalledWith('/repo', manifest, 'old')
    expect(saveManifest).toHaveBeenCalledWith('/repo', manifest)
  })
})
