import { describe, expect, it, vi } from 'vite-plus/test'
import type { DirectoryEntry } from '../../src/lib/types'
import {
  determineTrustTier,
  describeTrustTier,
  formatInstallPlan,
  isAllowedTargetPath,
  requiresConfirmation,
  validateTargetPaths,
} from '../../src/lib/trust'
import { OFFICIAL_REGISTRY_URL, fetchDirectoryIndex, isUrl } from '../../src/lib/registry'

vi.mock('../../src/lib/registry', () => ({
  OFFICIAL_REGISTRY_URL: 'https://registry.agentrig.ai/',
  DIRECTORY_INDEX_URL: 'https://registry.agentrig.ai/directory.json',
  fetchDirectoryIndex: vi.fn(),
  isUrl: vi.fn(),
}))

describe('trust', () => {
  it('returns official trust tier for official registry sources', async () => {
    const tier = await determineTrustTier(`${OFFICIAL_REGISTRY_URL}packs/core.json`)
    expect(tier).toBe('official')
  })

  it('returns listed trust tier for verified namespaced registry', async () => {
    const directory: DirectoryEntry[] = [
      { name: '@acme', url: 'https://acme/{name}.json', verified: true },
    ]
    vi.mocked(fetchDirectoryIndex).mockResolvedValue(directory)

    const tier = await determineTrustTier(
      '@acme/pack',
      { '@acme': { url: 'https://acme/{name}.json' } },
      'https://example.com/dir.json'
    )

    expect(tier).toBe('listed')
  })

  it('returns unlisted for namespaced registries when directory lookup fails', async () => {
    vi.mocked(fetchDirectoryIndex).mockRejectedValue(new Error('network'))

    const tier = await determineTrustTier(
      '@acme/pack',
      { '@acme': { url: 'https://acme/{name}.json' } },
      'https://example.com/dir.json'
    )

    expect(tier).toBe('unlisted')
  })

  it('returns listed for verified registry URLs', async () => {
    vi.mocked(isUrl).mockReturnValue(true)
    vi.mocked(fetchDirectoryIndex).mockResolvedValue([
      { name: '@verified', url: 'https://example.com/{name}.json', verified: true },
    ])

    const tier = await determineTrustTier(
      'https://example.com/core.json',
      undefined,
      'https://example.com/dir.json'
    )

    expect(tier).toBe('listed')
  })

  it('returns unlisted for unverified registry URLs', async () => {
    vi.mocked(isUrl).mockReturnValue(true)
    vi.mocked(fetchDirectoryIndex).mockResolvedValue([
      { name: '@unverified', url: 'https://example.com/{name}.json', verified: false },
    ])

    const tier = await determineTrustTier(
      'https://example.com/core.json',
      undefined,
      'https://example.com/dir.json'
    )

    expect(tier).toBe('unlisted')
  })

  it('returns unlisted for unknown sources', async () => {
    vi.mocked(isUrl).mockReturnValue(false)
    const tier = await determineTrustTier('core-pack')
    expect(tier).toBe('unlisted')
  })

  it('checks allowed target paths', () => {
    expect(isAllowedTargetPath('scripts/install.sh')).toBe(true)
    expect(isAllowedTargetPath('/.codex/skills/foo.md')).toBe(true)
    expect(isAllowedTargetPath('etc/passwd')).toBe(false)
  })

  it('validates target paths and expands placeholders', () => {
    const result = validateTargetPaths([
      { target: 'scripts/install.sh' },
      { target: '{{skillsDir}}/foo.md' },
      { target: 'etc/passwd' },
    ])

    expect(result.valid).toBe(false)
    expect(result.disallowed).toEqual(['etc/passwd'])
  })

  it('describes trust tiers and confirmation requirements', () => {
    expect(describeTrustTier('official')).toBe('Official agentrig.ai registry')
    expect(describeTrustTier('listed')).toBe('Community registry (listed in directory)')
    expect(describeTrustTier('unlisted')).toBe('Unlisted source (requires confirmation)')
    expect(requiresConfirmation('official')).toBe(false)
    expect(requiresConfirmation('listed')).toBe(false)
    expect(requiresConfirmation('unlisted')).toBe(true)
  })

  it('formats an install plan', () => {
    const plan = formatInstallPlan(
      'core-pack',
      [
        { path: 'src/index.md', target: '.codex/skills/index.md' },
        { path: 'src/README.md', target: 'scripts/setup.sh' },
      ],
      'listed'
    )

    expect(plan).toContain('Pack: core-pack')
    expect(plan).toContain('Trust: Community registry (listed in directory)')
    expect(plan).toContain('src/index.md -> .codex/skills/index.md')
    expect(plan).toContain('src/README.md -> scripts/setup.sh')
  })
})
