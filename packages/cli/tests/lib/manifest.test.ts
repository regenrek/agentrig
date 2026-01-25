import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Manifest } from '../../src/lib/types'
import { getManifestPath, loadManifest, saveManifest } from '../../src/lib/manifest'
import { ensureDir, readJsonFile, writeJsonFile } from '../../src/lib/fs'

vi.mock('../../src/lib/fs', () => ({
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  ensureDir: vi.fn(),
}))

describe('manifest', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('builds manifest path', () => {
    expect(getManifestPath('/repo')).toBe('/repo/.agentrig/manifest.json')
  })

  it('loads a valid manifest', async () => {
    const manifest: Manifest = {
      schemaVersion: 1,
      installed: {
        core: {
          name: 'core',
          version: '1.0.0',
          source: 'https://example.com/core.json',
          installedAt: '2026-01-25T00:00:00.000Z',
          files: [{ target: '.codex/skills/core.md' }],
        },
      },
    }
    vi.mocked(readJsonFile).mockResolvedValueOnce(manifest)

    const result = await loadManifest('/repo')
    expect(result).toEqual(manifest)
  })

  it('defaults when manifest is missing or invalid', async () => {
    vi.mocked(readJsonFile).mockResolvedValueOnce(null)
    const missing = await loadManifest('/repo')
    expect(missing).toEqual({ schemaVersion: 1, installed: {} })

    const invalid = { schemaVersion: 2, installed: {} } as unknown as Manifest
    vi.mocked(readJsonFile).mockResolvedValueOnce(invalid)
    const invalid = await loadManifest('/repo')
    expect(invalid).toEqual({ schemaVersion: 1, installed: {} })
  })

  it('saves manifest and ensures directory exists', async () => {
    const manifest: Manifest = { schemaVersion: 1, installed: {} }
    await saveManifest('/repo', manifest)
    expect(ensureDir).toHaveBeenCalledWith(path.join('/repo', '.agentrig'))
    expect(writeJsonFile).toHaveBeenCalledWith('/repo/.agentrig/manifest.json', manifest)
  })
})
