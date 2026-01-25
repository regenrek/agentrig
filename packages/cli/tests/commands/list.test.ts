import { beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/list'
import { loadConfig } from '../../src/lib/config'
import { loadManifest } from '../../src/lib/manifest'
import { isUrl, readRegistryIndex } from '../../src/lib/registry'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/manifest', () => ({
  loadManifest: vi.fn(),
}))
vi.mock('../../src/lib/registry', () => ({
  isUrl: vi.fn(),
  readRegistryIndex: vi.fn(),
}))

describe('command:list', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('lists installed and available packs', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [{ name: 'default', url: 'https://registry.example.com' }],
    })
    vi.mocked(loadManifest).mockResolvedValue({
      schemaVersion: 1,
      installed: {
        core: { name: 'core', version: '1.0.0', source: 'registry:default', installedAt: '', files: [] },
      },
    })
    vi.mocked(isUrl).mockReturnValue(false)
    vi.mocked(readRegistryIndex).mockResolvedValue({
      name: 'registry',
      items: [
        { name: 'core', title: 'Core', description: 'Core pack', meta: 'core.json', version: '1.0.0' },
      ],
    })

    await command.run({
      args: {
        cwd: '/repo',
        installed: true,
        available: true,
        registry: 'default',
        help: false,
      },
    })

    expect(readRegistryIndex).toHaveBeenCalledWith('https://registry.example.com')
  })
})
