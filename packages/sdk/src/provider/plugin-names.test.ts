import { describe, expect, it } from 'vitest'
import { isValidPluginName, sanitizeProviderPluginName, type ProviderPluginNameTarget } from './plugin-names'

const targets: ProviderPluginNameTarget[] = ['codex', 'cursor', 'claude']

describe('isValidPluginName', () => {
  it('accepts Open Plugins names with lowercase letters, digits, dots, and hyphens', () => {
    expect(isValidPluginName('regenrek.agent-skills')).toBe(true)
    expect(isValidPluginName('agentrig')).toBe(true)
    expect(isValidPluginName('a1.b2-c3')).toBe(true)
  })

  it('rejects malformed Open Plugins names', () => {
    expect(isValidPluginName('')).toBe(false)
    expect(isValidPluginName('AgentRig')).toBe(false)
    expect(isValidPluginName('-agentrig')).toBe(false)
    expect(isValidPluginName('agentrig-')).toBe(false)
    expect(isValidPluginName('agent--rig')).toBe(false)
    expect(isValidPluginName('agent..rig')).toBe(false)
    expect(isValidPluginName('a'.repeat(65))).toBe(false)
  })
})

describe('sanitizeProviderPluginName', () => {
  it.each(targets)('maps canonical plugin names to provider-safe kebab names for %s', (target) => {
    expect(sanitizeProviderPluginName('regenrek.agent-skills', target)).toBe('regenrek-agent-skills')
  })

  it.each(targets)('normalizes provider names to lowercase alphanumeric hyphen segments for %s', (target) => {
    expect(sanitizeProviderPluginName(' Acme.Example_SKILL Pack ', target)).toBe('acme-example-skill-pack')
  })

  it.each(targets)('keeps provider names letter-prefixed for %s', (target) => {
    expect(sanitizeProviderPluginName('123.tools', target)).toBe('plugin-123-tools')
  })
})
