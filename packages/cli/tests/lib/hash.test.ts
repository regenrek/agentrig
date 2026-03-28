import { describe, expect, it } from 'vite-plus/test'
import { sha256Hex } from '../../src/lib/hash'

describe('sha256Hex', () => {
  it('computes sha256 hex for known input', () => {
    const data = new TextEncoder().encode('hello')
    expect(sha256Hex(data)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('computes sha256 hex for empty input', () => {
    const data = new Uint8Array()
    expect(sha256Hex(data)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
