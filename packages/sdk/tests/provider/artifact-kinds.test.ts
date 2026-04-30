import { describe, expect, it } from 'vite-plus/test'
import {
  artifactKindFromSignalKind,
  formatArtifactSelector,
  parseArtifactSelector,
  uniqueArtifactSelectors,
} from '../../src/provider/artifact-kinds'

describe('artifact selectors', () => {
  it('normalizes canonical and helper selectors', () => {
    expect(parseArtifactSelector('skill:Review')).toEqual({
      kind: 'skill',
      name: 'review',
      selector: 'skill:review',
    })
    expect(parseArtifactSelector('Review', 'skill')).toEqual({
      kind: 'skill',
      name: 'review',
      selector: 'skill:review',
    })
    expect(formatArtifactSelector('mcp', 'GitHub')).toBe('mcp:github')
    expect(formatArtifactSelector('skill', 'regenrek.qa-single')).toBe('skill:regenrek.qa-single')
  })

  it('rejects ambiguous bare selectors and unsupported kinds', () => {
    expect(() => parseArtifactSelector('review')).toThrow(/kind prefix/i)
    expect(() => parseArtifactSelector('rule:typescript')).toThrow(/unsupported/i)
  })

  it('dedupes selectors after normalization', () => {
    expect(uniqueArtifactSelectors(['skill:Review', 'skill:review', 'mcp:github'])).toEqual([
      'mcp:github',
      'skill:review',
    ])
  })

  it('maps existing repo scan signal kinds onto artifact kinds', () => {
    expect(artifactKindFromSignalKind('skill')).toBe('skill')
    expect(artifactKindFromSignalKind('prompt')).toBe('command')
    expect(artifactKindFromSignalKind('doc')).toBeNull()
  })
})
