import { describe, expect, it } from 'vite-plus/test'
import {
  assertSelectionBundleInstallable,
  buildSelectionBundle,
  normalizeSelectionPick,
} from '../../src/provider/selection-bundle'
import type { SelectedArtifactForBundle } from '../../src/provider/selection-bundle'

const skillArtifact: SelectedArtifactForBundle = {
  kind: 'skill',
  name: 'review',
  selector: 'skill:review',
  sourcePath: 'skills/review',
  fileDigests: [{ path: 'skills/review/SKILL.md', digest: 'sha256:skill' }],
  dependencies: [],
  closureStatus: 'closed',
}

describe('Selection Bundle construction', () => {
  it('builds deterministic bundle ids independent of selection order', async () => {
    const mcpArtifact: SelectedArtifactForBundle = {
      kind: 'mcp',
      name: 'github',
      selector: 'mcp:github',
      sourcePath: 'mcp.json',
      fileDigests: [{ path: 'mcp.json', digest: 'sha256:mcp' }],
      dependencies: [],
      closureStatus: 'closed',
    }
    const source = {
      kind: 'external-repo-scan' as const,
      sourceLabel: 'owner/repo',
      scanDigest: 'abc123',
    }

    const left = await buildSelectionBundle({
      provider: 'codex',
      scope: 'workspace',
      source,
      selectedArtifacts: [skillArtifact, mcpArtifact],
    })
    const right = await buildSelectionBundle({
      provider: 'codex',
      scope: 'workspace',
      source,
      selectedArtifacts: [mcpArtifact, skillArtifact],
    })

    expect(left.selectionId).toBe(right.selectionId)
    const privateRoot = `.agentrig/selections/${left.selectionId.slice('sha256:'.length)}/plugins/github`
    const privateData = `.agentrig/selections/${left.selectionId.slice('sha256:'.length)}/data/github`
    expect(left.targetPaths).toEqual([`${privateRoot}/mcp.json`, '.mcp.json', 'skills/review/SKILL.md'])
    expect(left.materialization.jsonWrites).toEqual([
      {
        artifactSelector: 'mcp:github',
        keyPath: 'mcpServers',
        path: '.mcp.json',
        sourceDigest: 'sha256:mcp',
        sourcePath: 'mcp.json',
        compileMcp: {
          pluginRoot: privateRoot,
          pluginData: privateData,
        },
      },
    ])
  })

  it('requires closed artifacts before install', async () => {
    const bundle = await buildSelectionBundle({
      provider: 'codex',
      scope: 'workspace',
      source: { kind: 'external-repo-scan', sourceLabel: 'repo', scanDigest: 'abc123' },
      selectedArtifacts: [{ ...skillArtifact, closureStatus: 'requires-full-source' }],
    })

    expect(() => assertSelectionBundleInstallable(bundle)).toThrow(/not closed/i)
  })

  it('includes registry artifact kind in deterministic source identity', async () => {
    const baseSource = {
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      registryRef: 'agentrig/community.review@1.0.0',
      artifactId: 'community.review',
      version: '1.0.0',
      snapshotDigest: 'sha256:snapshot',
    }
    const skill = await buildSelectionBundle({
      provider: 'codex',
      scope: 'workspace',
      source: {
        kind: 'registry-artifact',
        artifactKind: 'skill',
        ...baseSource,
      },
      selectedArtifacts: [skillArtifact],
    })
    const plugin = await buildSelectionBundle({
      provider: 'codex',
      scope: 'workspace',
      source: {
        kind: 'registry-plugin',
        ...baseSource,
      },
      selectedArtifacts: [skillArtifact],
    })

    expect(skill.selectionId).not.toBe(plugin.selectionId)
    expect(skill.source).toMatchObject({ kind: 'registry-artifact', artifactKind: 'skill' })
  })

  it('normalizes kind-specific helper picks', () => {
    expect(normalizeSelectionPick('Review', 'skill')).toBe('skill:review')
    expect(() => normalizeSelectionPick('Review')).toThrow(/kind prefix/i)
  })
})
