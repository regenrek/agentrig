import { beforeEach, describe, expect, it, vi } from 'vitest'
import rigCommand from '../../src/commands/rig'
import listCommand from '../../src/commands/rig/list'
import applyCommand from '../../src/commands/rig/apply'
import { loadConfig } from '../../src/lib/config'
import { loadManifest, saveManifest } from '../../src/lib/manifest'
import { installPack, removePack } from '../../src/lib/install'

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
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('shows usage for rig wrapper', async () => {
    await rigCommand.run({ args: { help: false } })
  })

  it('lists rigs from config', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      rigs: {
        core: { packs: ['core'] },
        extra: { extends: ['core'], packs: ['extra'] },
      },
      defaultRig: 'core',
    })

    await listCommand.run({ args: { cwd: '/repo', help: false } })
    expect(loadConfig).toHaveBeenCalledWith('/repo')
  })

  it('applies rigs and prunes packs', async () => {
    const cfg = {
      skillsDir: '.codex/skills',
      registries: [],
      rigs: {
        base: { packs: ['core'] },
        extra: { extends: ['base'], packs: ['extra', 'core'] },
      },
      defaultRig: 'extra',
    }
    const manifest = {
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

    await applyCommand.run({
      args: {
        name: undefined,
        cwd: '/repo',
        registry: undefined,
        skillsDir: undefined,
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
