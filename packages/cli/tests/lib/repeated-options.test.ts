import { describe, expect, it } from 'vite-plus/test'
import { listRepeatedOptionValues } from '../../src/lib/repeated-options'

describe('listRepeatedOptionValues', () => {
  it('keeps repeated raw options that citty collapses to the last parsed value', () => {
    expect(
      listRepeatedOptionValues(
        'skill:gitwhat',
        ['--pick', 'skill:codex-analysis', '--pick', 'skill:gitwhat'],
        'pick',
      ),
    ).toEqual(['skill:codex-analysis', 'skill:gitwhat'])
  })

  it('supports comma and equals forms without duplicate last values', () => {
    expect(
      listRepeatedOptionValues(
        'skill:gitwhat',
        ['--pick=skill:codex-analysis,skill:gitwhat'],
        'pick',
      ),
    ).toEqual(['skill:codex-analysis', 'skill:gitwhat'])
  })
})
