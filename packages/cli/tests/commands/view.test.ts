import { beforeEach, describe, expect, it, vi } from 'vitest'
import command from '../../src/commands/view'
import { loadConfig } from '../../src/lib/config'
import {
  resolvePackByName,
  resolvePackFromMetaSpec,
  resolvePackFromNamespacedRegistry,
  isUrl,
} from '../../src/lib/registry'
import { describeTrustTier, determineTrustTier, validateTargetPaths } from '../../src/lib/trust'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/registry', () => ({
  resolvePackByName: vi.fn(),
  resolvePackFromMetaSpec: vi.fn(),
  resolvePackFromNamespacedRegistry: vi.fn(),
  isUrl: vi.fn(),
}))
vi.mock('../../src/lib/trust', () => ({
  determineTrustTier: vi.fn(),
  describeTrustTier: vi.fn(),
  validateTargetPaths: vi.fn(),
}))

describe('command:view', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prints JSON output for URL specs', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [],
      namespacedRegistries: undefined,
    })
    vi.mocked(isUrl).mockReturnValue(true)
    const meta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [],
    }
    vi.mocked(resolvePackFromMetaSpec).mockResolvedValue({
      meta,
      source: { type: 'url', baseUrl: 'https://example.com/' },
      sourceLabel: 'url:https://example.com/core.json',
      trustTier: 'listed',
    })
    vi.mocked(validateTargetPaths).mockReturnValue({ valid: true, disallowed: [] })

    const logSpy = vi.spyOn(console, 'log')
    await command.run({
      args: {
        spec: 'https://example.com/core.json',
        cwd: '/repo',
        registry: undefined,
        json: true,
        help: false,
      },
    })

    const output = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(output)
    expect(parsed.name).toBe('core')
    expect(parsed.source).toBe('url:https://example.com/core.json')
    expect(parsed.trustTier).toBe('listed')
  })

  it('prints human output for namespaced specs', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      registries: [],
      namespacedRegistries: { '@acme': 'https://acme/{name}.json' },
    })
    vi.mocked(isUrl).mockReturnValue(false)
    const meta = {
      name: 'pack',
      title: 'Pack',
      description: 'Pack desc',
      version: '1.0.0',
      files: [{ path: 'skills/foo.md', target: '{{skillsDir}}/foo.md' }],
    }
    vi.mocked(resolvePackFromNamespacedRegistry).mockResolvedValue({
      meta,
      source: { type: 'url', baseUrl: 'https://acme/' },
      sourceLabel: '@acme/pack',
      trustTier: undefined,
    })
    vi.mocked(determineTrustTier).mockResolvedValue('unlisted')
    vi.mocked(describeTrustTier).mockReturnValue('Unlisted source')
    vi.mocked(validateTargetPaths).mockReturnValue({ valid: false, disallowed: ['etc/passwd'] })

    await command.run({
      args: {
        spec: '@acme/pack',
        cwd: '/repo',
        registry: undefined,
        json: false,
        help: false,
      },
    })

    expect(describeTrustTier).toHaveBeenCalledWith('unlisted')
  })
})
