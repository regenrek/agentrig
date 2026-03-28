import { describe, expect, it } from 'vite-plus/test'
import { renderTemplate } from '../../src/lib/placeholders'

describe('renderTemplate', () => {
  it('renders known template variables', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World')
  })

  it('supports spaced template variables', () => {
    expect(renderTemplate('Hi {{ name }}', { name: 'Agent' })).toBe('Hi Agent')
  })

  it('preserves unknown variables', () => {
    expect(renderTemplate('Hi {{missing}}', { name: 'Agent' })).toBe('Hi {{missing}}')
  })

  it('renders multiple variables', () => {
    expect(renderTemplate('{{greet}} {{name}}', { greet: 'Hello', name: 'Team' })).toBe(
      'Hello Team'
    )
  })
})
