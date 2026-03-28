import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import command from '../../src/commands/view'
import type { ResolvedConfig } from '../../src/lib/config'
import { loadConfig } from '../../src/lib/config'
import { resolvePackSpec } from '../../src/lib/pack-resolver'
import { describeTrustTier, determineTrustTier, validateTargetPaths } from '../../src/lib/trust'

vi.mock('../../src/lib/config', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/lib/pack-resolver', () => ({
  resolvePackSpec: vi.fn(),
}))
vi.mock('../../src/lib/trust', () => ({
  determineTrustTier: vi.fn(),
  describeTrustTier: vi.fn(),
  validateTargetPaths: vi.fn(),
}))

describe('command:view', () => {
  const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prints JSON output for URL specs', async () => {
    const cfg: ResolvedConfig = {
      registries: [],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    const meta = {
      name: 'core',
      title: 'Core',
      description: 'Core pack',
      version: '1.0.0',
      files: [],
    }
    vi.mocked(resolvePackSpec).mockResolvedValue({
      meta,
      source: { type: 'url', baseUrl: 'https://example.com/' },
      sourceLabel: 'url:https://example.com/core.json',
      trustTier: 'listed',
    })
    vi.mocked(validateTargetPaths).mockReturnValue({ valid: true, disallowed: [] })

    const logSpy = vi.spyOn(console, 'log')
    await run({
      args: {
        spec: 'https://example.com/core.json',
        cwd: '/repo',
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

  it('prints human output for aliased registry specs', async () => {
    const cfg: ResolvedConfig = {
      registries: [{ name: 'georg', url: 'https://georg.dev/agentrig' }],
      rigs: {},
      paths: {
        projectConfigPath: '/repo/agentrig.config.json',
        globalConfigPath: '/home/.agentrig/config.json',
      },
    }
    vi.mocked(loadConfig).mockResolvedValue(cfg)
    const meta = {
      name: 'pack',
      title: 'Pack',
      description: 'Pack desc',
      version: '1.0.0',
      files: [{ path: 'skills/foo.md', target: '{{skillsDir}}/foo.md' }],
    }
    vi.mocked(resolvePackSpec).mockResolvedValue({
      meta,
      source: { type: 'url', baseUrl: 'https://georg.dev/agentrig' },
      sourceLabel: 'registry:georg',
      trustTier: undefined,
    })
    vi.mocked(determineTrustTier).mockResolvedValue('listed')
    vi.mocked(describeTrustTier).mockReturnValue('Configured registry')
    vi.mocked(validateTargetPaths).mockReturnValue({ valid: false, disallowed: ['etc/passwd'] })

    await run({
      args: {
        spec: 'georg/pack',
        cwd: '/repo',
        json: false,
        help: false,
      },
    })

    expect(describeTrustTier).toHaveBeenCalledWith('listed')
  })
})
