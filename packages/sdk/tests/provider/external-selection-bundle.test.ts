import { describe, expect, it } from 'vite-plus/test'
import { buildExternalSelectionBundle } from '../../src/provider/external-selection-bundle'
import { assertSelectionBundleInstallable } from '../../src/provider/selection-bundle'
import { scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from '../repo-scan/memory-tree'

describe('buildExternalSelectionBundle', () => {
  it('builds an installable external-repo-scan Selection Bundle from selected artifact paths', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
      'README.md': '# Repo',
    })
    const report = await scanRepo({ source: { type: 'virtual', label: 'owner/repo' }, tree })
    const result = await buildExternalSelectionBundle({
      tree,
      report,
      selectedSourcePaths: ['skills/review'],
      provider: 'cursor',
      scope: 'workspace',
      source: {
        kind: 'external-repo-scan',
        sourceLabel: 'owner/repo',
        owner: 'owner',
        repo: 'repo',
        scanDigest: report.digest,
      },
    })

    expect(result.bundle.source.kind).toBe('external-repo-scan')
    expect(result.bundle.selectedArtifacts.map((artifact) => artifact.selector)).toEqual(['skill:review'])
    expect(result.bundle.targetPaths).toEqual(['.cursor/skills/review/SKILL.md'])
    expect(() => assertSelectionBundleInstallable(result.bundle)).not.toThrow()
  })

  it('rejects selected docs because docs are not installable artifacts', async () => {
    const tree = createMemoryTree({
      'README.md': '# Repo',
    })
    const report = await scanRepo({ source: { type: 'virtual', label: 'owner/repo' }, tree })

    await expect(buildExternalSelectionBundle({
      tree,
      report,
      selectedSourcePaths: ['README.md'],
      provider: 'cursor',
      scope: 'workspace',
      source: {
        kind: 'external-repo-scan',
        sourceLabel: 'owner/repo',
        scanDigest: report.digest,
      },
    })).rejects.toThrow(/not an installable artifact/i)
  })
})
