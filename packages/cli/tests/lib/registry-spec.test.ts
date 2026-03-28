import { describe, expect, it } from 'vite-plus/test'
import {
  isAliasedPackSpec,
  isValidPackName,
  isValidRegistryAlias,
  parseRegistryPackSpec,
} from '../../src/lib/registry-spec'

describe('registry spec utilities', () => {
  it('parses official pack specs without a registry alias', () => {
    expect(parseRegistryPackSpec('core-committer')).toEqual({
      registry: null,
      pack: 'core-committer',
    })
  })

  it('parses aliased pack specs', () => {
    expect(parseRegistryPackSpec('georg/ts-master-pack')).toEqual({
      registry: 'georg',
      pack: 'ts-master-pack',
    })
    expect(isAliasedPackSpec('georg/ts-master-pack')).toBe(true)
  })

  it('rejects slash specs that do not match the new contract', () => {
    expect(() => parseRegistryPackSpec('georg/BadPack')).toThrow('Invalid pack spec')
  })

  it('validates registry aliases and pack names', () => {
    expect(isValidRegistryAlias('official')).toBe(true)
    expect(isValidRegistryAlias('georg-dev')).toBe(true)
    expect(isValidRegistryAlias('Georg')).toBe(false)

    expect(isValidPackName('core-committer')).toBe(true)
    expect(isValidPackName('ts-master-pack')).toBe(true)
    expect(isValidPackName('BadPack')).toBe(false)
  })
})
