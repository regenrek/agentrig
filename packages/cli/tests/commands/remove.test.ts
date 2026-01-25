import { beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/remove'
import { loadManifest, saveManifest } from '../../src/lib/manifest'
import { removePack } from '../../src/lib/install'

vi.mock('../../src/lib/manifest', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
}))
vi.mock('../../src/lib/install', () => ({
  removePack: vi.fn(),
}))

describe('command:remove', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('removes pack and saves manifest', async () => {
    const manifest = { schemaVersion: 1, installed: {} }
    vi.mocked(loadManifest).mockResolvedValue(manifest)
    vi.mocked(removePack).mockResolvedValue({ removed: ['file'], kept: [], missing: [] })

    await command.run({
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
