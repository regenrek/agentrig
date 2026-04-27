import { describe, expect, it } from 'vitest'
import { detectPathSignals } from './path'
import type { VirtualTree, VirtualTreeFile } from '../virtual-tree'

describe('detectPathSignals', () => {
  it('does not emit path-only agent signals for files near SKILL.md packages', () => {
    const files = [
      file('agents/skills/audit-ai-code/SKILL.md'),
      file('agents/skills/audit-ai-code/references/sources.md'),
      file('agents/skills/audit-ai-code/patterns/review.md'),
      file('agents/prompts/gh-commit.md'),
    ]

    const signals = detectPathSignals({ tree: fakeTree, files, pluginCandidates: [], roots: [''] })

    expect(signals.map((signal) => signal.sourcePath)).toEqual([])
  })
})

const fakeTree: VirtualTree = {
  async listEntries() {
    return []
  },
  async readText() {
    return null
  },
}

function file(path: string): VirtualTreeFile {
  return {
    path,
    kind: 'file',
    bytes: 1,
    sha256: `sha-${path}`,
  }
}
