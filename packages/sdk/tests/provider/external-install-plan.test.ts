import { describe, expect, it } from 'vitest'
import { buildExternalInstallPlan } from '../../src/provider/external-install-plan'

const closed = {
  selector: 'skill:review',
  status: 'closed' as const,
  requiredSelectors: [],
  requiredPaths: [],
}

describe('buildExternalInstallPlan', () => {
  it('builds a command only from closed installable artifacts', () => {
    const plan = buildExternalInstallPlan({
      repoFullName: 'anthropics/skills',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      scanDigest: 'd'.repeat(64),
      signals: [{
        kind: 'skill',
        id: 'review',
        title: 'Review',
        sourcePath: 'skills/review',
        files: [{ path: 'skills/review/SKILL.md', sha256: 'f'.repeat(64), bytes: 42 }],
        score: 1,
      }],
      artifactClosures: [closed],
      selectedSourcePaths: ['skills/review'],
      provider: 'all',
    })

    expect(plan.artifacts).toHaveLength(1)
    expect(plan.artifacts[0].installable).toBe(true)
    expect(plan.command).toBe('agentrig use anthropics/skills --ref abcdef1234567890abcdef1234567890abcdef12 --pick skills/review --install --provider all')
  })

  it('blocks command generation for non-closed artifacts', () => {
    const plan = buildExternalInstallPlan({
      repoFullName: 'anthropics/skills',
      scanDigest: 'd'.repeat(64),
      signals: [{
        kind: 'skill',
        id: 'review',
        title: 'Review',
        sourcePath: 'skills/review',
        files: [{ path: 'skills/review/SKILL.md', sha256: 'f'.repeat(64), bytes: 42 }],
        score: 1,
      }],
      selectedSourcePaths: ['skills/review'],
    })

    expect(plan.artifacts[0].installable).toBe(false)
    expect(plan.command).toBeUndefined()
    expect(plan.commandBlockedReason).toMatch(/cannot install/i)
  })

  it('does not expose non-artifact signals as installable artifacts', () => {
    const plan = buildExternalInstallPlan({
      repoFullName: 'anthropics/skills',
      scanDigest: 'd'.repeat(64),
      signals: [{
        kind: 'doc',
        id: 'readme',
        title: 'Readme',
        sourcePath: 'README.md',
        files: [{ path: 'README.md', sha256: 'f'.repeat(64), bytes: 42 }],
        score: 0.2,
      }],
      selectedSourcePaths: ['README.md'],
    })

    expect(plan.artifacts).toEqual([])
    expect(plan.unknownSelectedSourcePaths).toEqual(['README.md'])
    expect(plan.command).toBeUndefined()
  })
})
