import { describe, expect, it } from 'vitest'
import { buildAgentrigUseCommand, deriveExternalPluginId } from '../../src/provider/external-use-command'

describe('buildAgentrigUseCommand', () => {
  it('builds a single-pick install command pinned to the resolved commit', () => {
    const cmd = buildAgentrigUseCommand({
      repoFullName: 'anthropics/skills',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      picks: ['skills/review'],
    })
    expect(cmd).toBe('agentrig use anthropics/skills --ref abcdef1234567890abcdef1234567890abcdef12 --pick skills/review --install --provider all')
  })

  it('joins multiple picks with comma and supports provider override', () => {
    const cmd = buildAgentrigUseCommand({
      repoFullName: 'anthropics/skills',
      commitSha: 'abcdef1',
      picks: ['skills/review', 'mcp/foo', '.mcp.json'],
      provider: 'codex',
    })
    expect(cmd).toBe('agentrig use anthropics/skills --ref abcdef1 --pick skills/review,mcp/foo,.mcp.json --install --provider codex')
  })

  it('includes explicit refs when no commit sha is available', () => {
    const cmd = buildAgentrigUseCommand({
      repoFullName: 'anthropics/skills',
      ref: 'main',
      picks: ['skills/review'],
    })
    expect(cmd).toContain('agentrig use anthropics/skills')
    expect(cmd).toContain('--ref main')
    expect(cmd).toContain('--pick skills/review')
  })

  it('includes --path when subdir is provided', () => {
    const cmd = buildAgentrigUseCommand({
      repoFullName: 'anthropics/skills',
      commitSha: 'abcdef1',
      subdir: 'packages/sub',
      picks: ['skills/review'],
    })
    expect(cmd).toContain('--path packages/sub')
    expect(cmd).toContain('--ref abcdef1')
  })

  it('supports --as-plugin mode with a sanitized id', () => {
    const cmd = buildAgentrigUseCommand({
      repoFullName: 'anthropics/skills',
      commitSha: 'abcdef1',
      picks: ['skills/review'],
      mode: { kind: 'as-plugin', pluginId: 'external.anthropics-skills' },
    })
    expect(cmd).toContain('--as-plugin external.anthropics-skills')
    expect(cmd).not.toContain('--install')
  })

  it('rejects malicious repo names', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills; rm -rf /',
        commitSha: 'abcdef1',
        picks: ['skills/review'],
      })
    ).toThrow(/Invalid repoFullName/)
  })

  it('rejects picks starting with a dash to avoid flag injection', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills',
        commitSha: 'abcdef1',
        picks: ['-rf'],
      })
    ).toThrow(/Invalid pick/)
  })

  it('rejects picks with shell metacharacters', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills',
        commitSha: 'abcdef1',
        picks: ['skills/review;evil'],
      })
    ).toThrow(/Invalid pick/)
  })

  it('rejects empty picks', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills',
        commitSha: 'abcdef1',
        picks: [],
      })
    ).toThrow(/at least one pick/)
  })

  it('rejects malformed commit sha', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills',
        commitSha: 'not-a-sha!',
        picks: ['skills/review'],
      })
    ).toThrow(/Invalid commitSha/)
  })

  it('rejects unknown providers', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills',
        commitSha: 'abcdef1',
        picks: ['skills/review'],
        provider: 'evil' as never,
      })
    ).toThrow(/Invalid provider/)
  })

  it('rejects malformed Open Plugins names in as-plugin mode', () => {
    expect(() =>
      buildAgentrigUseCommand({
        repoFullName: 'anthropics/skills',
        commitSha: 'abcdef1',
        picks: ['skills/review'],
        mode: { kind: 'as-plugin', pluginId: 'Invalid Id!' },
      })
    ).toThrow(/Invalid Open Plugins name/)
  })

  it('quotes picks containing spaces', () => {
    const cmd = buildAgentrigUseCommand({
      repoFullName: 'anthropics/skills',
      commitSha: 'abcdef1',
      picks: ['skills/with space'],
    })
    expect(cmd).toContain("--pick 'skills/with space'")
  })
})

describe('deriveExternalPluginId', () => {
  it('returns external.<owner>-<repo> in lowercase', () => {
    expect(deriveExternalPluginId('Anthropics/Skills')).toBe('external.anthropics-skills')
  })

  it('collapses non-alphanumeric runs to a single dash', () => {
    expect(deriveExternalPluginId('foo-bar/baz_qux')).toBe('external.foo-bar-baz-qux')
  })

  it('rejects malformed repo names', () => {
    expect(() => deriveExternalPluginId('not a repo')).toThrow()
  })
})
