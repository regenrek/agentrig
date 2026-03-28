import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/add'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import { loadManifest, saveManifest } from '../../src/lib/manifest'
import { installPack } from '../../src/lib/install'
import { describeTrustTier } from '../../src/lib/trust'
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
}))
vi.mock('../../src/lib/trust', () => ({
  describeTrustTier: vi.fn(),
}))

describe('command:add', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('installs packs and saves the manifest', async () => {
    const cfg: ResolvedConfig = {
      skillsDir: '.codex/skills',
      registries: [{ name: 'default', url: 'https://registry.example.com' }],
      namespacedRegistries: { '@acme': 'https://acme/{name}.json' },
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    const manifest: Manifest = { schemaVersion: 1, installed: {} }
    vi.mocked(loadManifest).mockResolvedValue(manifest)
    vi.mocked(installPack).mockResolvedValue({ installed: ['a'], skipped: [], trustTier: 'listed' })
    vi.mocked(describeTrustTier).mockReturnValue('Community registry (listed in directory)')

    await run({
      args: {
        spec: 'core',
        cwd: '/repo',
        registry: 'default',
        force: false,
        dryRun: false,
        yes: false,
        help: false,
      },
    })

    expect(installPack).toHaveBeenCalledWith(
      'core',
      {
        registries: [{ name: 'default', url: 'https://registry.example.com' }],
        namespacedRegistries: { '@acme': 'https://acme/{name}.json' },
      },
      manifest,
      expect.objectContaining({
        cwd: '/repo',
        skillsDir: '.codex/skills',
        force: false,
        dryRun: false,
        registry: 'default',
        yes: false,
      })
    )
    expect(saveManifest).toHaveBeenCalled()
  })

  it('skips manifest save during dry runs', async () => {
    const cfg: ResolvedConfig = {
      skillsDir: '.codex/skills',
      registries: [],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    const manifest: Manifest = { schemaVersion: 1, installed: {} }
    vi.mocked(loadManifest).mockResolvedValue(manifest)
    vi.mocked(installPack).mockResolvedValue({ installed: ['a'], skipped: ['b'], trustTier: undefined })

    await run({
      args: {
        spec: 'core',
        cwd: '/repo',
        force: false,
        dryRun: true,
        yes: false,
        help: false,
      },
    })

    expect(saveManifest).not.toHaveBeenCalled()
  })
})
