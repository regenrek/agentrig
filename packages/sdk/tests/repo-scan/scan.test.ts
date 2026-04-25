import { describe, expect, it } from 'vite-plus/test'
import { filterSignalsByKind, scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from './memory-tree'

describe('scanRepo', () => {
  it('returns stable reports and digest over tier 1 signals only', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
      'prompts/explain.md': '# Explain',
      'README.md': '# Repo',
    })

    const first = await scanRepo({
      source: { type: 'virtual', label: 'fixture' },
      tree,
    })
    const second = await scanRepo({
      source: { type: 'virtual', label: 'fixture' },
      tree,
    })

    expect(first).toEqual(second)
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.signals.map((signal) => [signal.kind, signal.sourcePath])).toEqual([
      ['prompt', 'prompts/explain.md'],
      ['doc', 'README.md'],
      ['skill', 'skills/review'],
    ])
  })

  it('keeps filtering separate from canonical scan digest', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
      'prompts/explain.md': '# Explain',
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })
    const skillsOnly = filterSignalsByKind(report.signals, ['skill'])

    expect(skillsOnly).toHaveLength(1)
    expect(skillsOnly[0].kind).toBe('skill')
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/)
  })
})
