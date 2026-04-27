import { describe, expect, it } from 'vite-plus/test'
import {
  parseRegistryArtifactSpec,
  parseRegistryPluginSpec,
} from '../../src/lib/registry-spec'

describe('registry spec parsing', () => {
  it('parses plugin refs with plugin-specific field names', () => {
    expect(parseRegistryPluginSpec('agentrig/community.typescript@1.2.3')).toEqual({
      registry: 'agentrig',
      plugin: 'community.typescript',
      version: '1.2.3',
    })
  })

  it('parses standalone artifact refs with explicit artifact kind', () => {
    expect(parseRegistryArtifactSpec('agentrig/community.review@1.2.3', 'skill')).toEqual({
      registry: 'agentrig',
      artifactKind: 'skill',
      artifact: 'community.review',
      version: '1.2.3',
    })
  })
})
