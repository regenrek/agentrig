import { describe, expect, it, vi } from 'vite-plus/test'
import {
  determineTrustTier,
  describeTrustTier,
  formatInstallPlan,
  isAllowedTargetPath,
  requiresConfirmation,
  validateTargetPaths,
} from '../../src/lib/trust'
import { OFFICIAL_REGISTRY_URL, isUrl } from '../../src/lib/registry'

vi.mock('../../src/lib/registry', () => ({
  OFFICIAL_REGISTRY_URL: 'https://registry.agentrig.ai/',
  isUrl: vi.fn(),
  normalizeRegistryUrl: (value: string) => value.replace(/\/+$/, ''),
}))

describe('trust', () => {
  it('returns official trust tier for official registry sources', async () => {
    const tier = await determineTrustTier(`${OFFICIAL_REGISTRY_URL}packs/core.json`)
    expect(tier).toBe('official')
  })

  it('returns listed trust tier for configured registry URLs', async () => {
    vi.mocked(isUrl).mockReturnValue(true)
    const tier = await determineTrustTier('https://georg.dev/agentrig/packs/core.json', [
      { name: 'georg', url: 'https://georg.dev/agentrig' },
    ])

    expect(tier).toBe('listed')
  })

  it('returns unlisted for unknown direct URLs', async () => {
    vi.mocked(isUrl).mockReturnValue(true)
    const tier = await determineTrustTier('https://unknown.dev/core.json', [
      { name: 'georg', url: 'https://georg.dev/agentrig' },
    ])
    expect(tier).toBe('unlisted')
  })

  it('returns unlisted for unknown sources', async () => {
    vi.mocked(isUrl).mockReturnValue(false)
    const tier = await determineTrustTier('core-pack')
    expect(tier).toBe('unlisted')
  })

  it('checks allowed target paths', () => {
    expect(isAllowedTargetPath('.agentrig/install.json')).toBe(true)
    expect(isAllowedTargetPath('/.codex/skills/foo.md')).toBe(true)
    expect(isAllowedTargetPath('etc/passwd')).toBe(false)
  })

  it('validates target paths and expands placeholders', () => {
    const result = validateTargetPaths([
      { target: '.agentrig/install.json' },
      { target: '{{skillsDir}}/foo.md' },
      { target: 'etc/passwd' },
    ])

    expect(result.valid).toBe(false)
    expect(result.disallowed).toEqual(['etc/passwd'])
  })

  it('rejects traversal after placeholder expansion', () => {
    const result = validateTargetPaths([{ target: '{{skillsDir}}/../outside.txt' }])
    expect(result.valid).toBe(false)
    expect(result.disallowed).toEqual(['{{skillsDir}}/../outside.txt'])
  })

  it('describes trust tiers and confirmation requirements', () => {
    expect(describeTrustTier('official')).toBe('Official agentrig.ai registry')
    expect(describeTrustTier('listed')).toBe('Configured registry')
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
        { path: 'src/README.md', target: '.agentrig/setup.json' },
      ],
      'listed'
    )

    expect(plan).toContain('Pack: core-pack')
    expect(plan).toContain('Trust: Configured registry')
    expect(plan).toContain('src/index.md -> .codex/skills/index.md')
    expect(plan).toContain('src/README.md -> .agentrig/setup.json')
  })
})
