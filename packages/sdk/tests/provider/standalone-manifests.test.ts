import { describe, expect, it } from 'vite-plus/test'
import {
  artifactKindFromStandaloneManifest,
  parseStandaloneArtifactManifest,
} from '../../src/provider/standalone-manifests'

describe('standalone artifact manifests', () => {
  it('parses skill manifests with defaults', () => {
    const manifest = parseStandaloneArtifactManifest({
      kind: 'agentrig:skill',
      id: 'community.review',
      name: 'Review',
      description: 'Reviews code.',
      version: '1.0.0',
    })

    expect(manifest).toMatchObject({ entry: 'SKILL.md' })
    expect(artifactKindFromStandaloneManifest(manifest)).toBe('skill')
  })

  it('accepts schema metadata across standalone manifest kinds', () => {
    const cases = [
      {
        kind: 'agentrig:skill' as const,
        id: 'community.review',
        expectedKind: 'skill' as const,
      },
      {
        kind: 'agentrig:mcp' as const,
        id: 'community.server',
        expectedKind: 'mcp' as const,
      },
      {
        kind: 'agentrig:hook' as const,
        id: 'community.guard',
        expectedKind: 'hook' as const,
      },
    ]

    for (const testCase of cases) {
      const manifest = parseStandaloneArtifactManifest({
        $schema: 'https://agentrig.ai/schema/artifact-manifest.v1.json',
        kind: testCase.kind,
        id: testCase.id,
        name: 'Review',
        description: 'Reviews code.',
        version: '1.0.0',
      })

      expect(manifest.$schema).toBe('https://agentrig.ai/schema/artifact-manifest.v1.json')
      expect(artifactKindFromStandaloneManifest(manifest)).toBe(testCase.expectedKind)
    }
  })

  it('rejects unknown manifest keys', () => {
    expect(() =>
      parseStandaloneArtifactManifest({
        kind: 'agentrig:skill',
        id: 'community.review',
        name: 'Review',
        description: 'Reviews code.',
        version: '1.0.0',
        unexpected: true,
      })
    ).toThrow()
  })

  it('rejects unknown standalone kinds', () => {
    expect(() =>
      parseStandaloneArtifactManifest({
        kind: 'agentrig:plugin',
        id: 'community.review',
        name: 'Review',
        description: 'Reviews code.',
        version: '1.0.0',
      })
    ).toThrow()
  })
})
