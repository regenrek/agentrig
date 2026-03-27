import { describe, expect, it } from 'vitest'
import { shouldShowParentUsage } from '../../src/lib/command'

describe('command helper', () => {
  it('shows parent usage when no subcommand was provided', () => {
    expect(shouldShowParentUsage([])).toBe(true)
    expect(shouldShowParentUsage(['--base-url', 'http://localhost:5173'])).toBe(false)
  })

  it('does not show parent usage when a subcommand exists', () => {
    expect(shouldShowParentUsage(['login'])).toBe(false)
    expect(shouldShowParentUsage(['login', '--base-url', 'http://localhost:5173'])).toBe(false)
    expect(shouldShowParentUsage(['create', '.'])).toBe(false)
  })
})
