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

  it('lifts root AgentRig plugin identity into scan plugin candidates', async () => {
    const tree = createMemoryTree({
      '.plugin/plugin.json': JSON.stringify({
        kind: 'agentrig:plugin',
        id: 'regenrek.test-submission',
        name: 'Test Submission',
        description: 'Reference plugin.',
        version: '0.2.0',
        configSchema: {},
      }),
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })

    expect(report.pluginCandidates).toEqual([
      {
        artifactId: 'regenrek.test-submission',
        version: '0.2.0',
        sourcePath: '.',
        manifestPath: '.plugin/plugin.json',
        files: expect.arrayContaining([
          expect.objectContaining({ path: '.plugin/plugin.json' }),
          expect.objectContaining({ path: 'skills/review/SKILL.md' }),
        ]),
      },
    ])
  })
})
