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
