import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/remove'
import { loadManifest, saveManifest } from '../../src/lib/manifest'
import { removePack } from '../../src/lib/install'
import type { Manifest } from '../../src/lib/types'

vi.mock('../../src/lib/manifest', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
}))
vi.mock('../../src/lib/install', () => ({
  removePack: vi.fn(),
}))

describe('command:remove', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('removes pack and saves manifest', async () => {
    const manifest: Manifest = { schemaVersion: 1, installed: {} }
    vi.mocked(loadManifest).mockResolvedValue(manifest)
    vi.mocked(removePack).mockResolvedValue({ removed: ['file'], kept: [], missing: [] })

    await run({
      args: {
        name: 'core',
        cwd: '/repo',
        help: false,
      },
    })

    expect(removePack).toHaveBeenCalledWith('/repo', manifest, 'core')
    expect(saveManifest).toHaveBeenCalledWith('/repo', manifest)
  })
})
