import { describe, expect, it } from 'vitest'
import { sanitizeProviderPluginName, type ProviderPluginNameTarget } from './plugin-names'

const targets: ProviderPluginNameTarget[] = ['codex', 'cursor', 'claude']

describe('sanitizeProviderPluginName', () => {
  it.each(targets)('maps dotted artifact IDs to provider-safe kebab names for %s', (target) => {
    expect(sanitizeProviderPluginName('regenrek.agent-skills', target)).toBe('regenrek-agent-skills')
  })

  it.each(targets)('normalizes provider names to lowercase alphanumeric hyphen segments for %s', (target) => {
    expect(sanitizeProviderPluginName(' Acme.Example_SKILL Pack ', target)).toBe('acme-example-skill-pack')
  })

  it.each(targets)('keeps provider names letter-prefixed for %s', (target) => {
    expect(sanitizeProviderPluginName('123.tools', target)).toBe('plugin-123-tools')
  })
})
