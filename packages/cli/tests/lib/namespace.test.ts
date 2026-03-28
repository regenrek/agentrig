import { describe, expect, it } from 'vite-plus/test'
import {
  buildRegistryUrl,
  expandEnvVars,
  extractEnvVars,
  isNamespace,
  isNamespacedPack,
  isValidPackName,
  parseRegistryAndItemFromString,
} from '../../src/lib/namespace'

describe('namespace utilities', () => {
  it('parses non-namespaced pack names', () => {
    expect(parseRegistryAndItemFromString('core-committer')).toEqual({
      registry: null,
      item: 'core-committer',
    })
  })

  it('parses namespaced pack names', () => {
    expect(parseRegistryAndItemFromString('@acme/tauri-rust')).toEqual({
      registry: '@acme',
      item: 'tauri-rust',
    })
  })

  it('returns raw item for invalid namespace patterns', () => {
    expect(parseRegistryAndItemFromString('@acme')).toEqual({
      registry: null,
      item: '@acme',
    })
  })

  it('detects namespace and namespaced pack references', () => {
    expect(isNamespace('@acme')).toBe(true)
    expect(isNamespace('acme')).toBe(false)
    expect(isNamespacedPack('@acme/pack')).toBe(true)
    expect(isNamespacedPack('@acme')).toBe(false)
  })

  it('validates pack name pattern', () => {
    expect(isValidPackName('alpha')).toBe(true)
    expect(isValidPackName('alpha-1')).toBe(true)
    expect(isValidPackName('a')).toBe(true)
    expect(isValidPackName('Foo')).toBe(false)
    expect(isValidPackName('foo-')).toBe(false)
    expect(isValidPackName('foo_bar')).toBe(false)
  })

  it('builds registry URLs from templates', () => {
    expect(buildRegistryUrl('https://example.com/{name}.json', 'core')).toBe(
      'https://example.com/core.json'
    )
  })

  it('throws when registry template is invalid', () => {
    expect(() => buildRegistryUrl('https://example.com/core.json', 'core')).toThrow(
      'Registry URL template must include {name} placeholder'
    )
  })

  it('expands environment variables in strings', () => {
    process.env.NAMESPACE_TEST_VAR = 'value'
    expect(expandEnvVars('hello ${NAMESPACE_TEST_VAR}')).toBe('hello value')
  })

  it('throws when environment variables are missing', () => {
    delete process.env.NAMESPACE_MISSING_VAR
    expect(() => expandEnvVars('missing ${NAMESPACE_MISSING_VAR}')).toThrow(
      'Environment variable NAMESPACE_MISSING_VAR is not set'
    )
  })

  it('extracts environment variables from strings', () => {
    expect(extractEnvVars('a ${ONE} b ${TWO} c ${ONE}')).toEqual(['ONE', 'TWO', 'ONE'])
  })
})
