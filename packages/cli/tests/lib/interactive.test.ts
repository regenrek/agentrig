import { describe, expect, it } from 'vite-plus/test'
import { selectOption } from '../../src/lib/interactive'

describe('interactive selection', () => {
  it('exists for integration via command mocks', () => {
    expect(typeof selectOption).toBe('function')
  })
})
