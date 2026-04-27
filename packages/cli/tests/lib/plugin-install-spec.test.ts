import { describe, expect, it } from 'vite-plus/test'
import {
  getPluginInstallSpecIdentityKey,
  isSamePluginInstallSpecIdentity,
  normalizeRegistryArtifactInstallSpecIdentity,
} from '../../src/lib/plugin-install-spec'
import type { PluginInstallSpecIdentity } from '../../src/lib/types'

describe('plugin install spec identity', () => {
  it('keeps registry and external-repo identities separate', () => {
    const registry: PluginInstallSpecIdentity = {
      kind: 'registry',
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      pluginId: 'community.review',
      version: '0.1.0',
    }
    const external: PluginInstallSpecIdentity = {
      kind: 'external-repo',
      repoUrl: 'https://github.com/acme/dots',
      owner: 'acme',
      repo: 'dots',
      commitSha: 'abc123',
      scanDigest: 'a'.repeat(64),
      pickedSignalPaths: ['skills/review'],
      pluginId: 'community.review',
      version: '0.1.0',
    }

    expect(getPluginInstallSpecIdentityKey(registry)).toBe('registry:agentrig:community.review@0.1.0')
    expect(getPluginInstallSpecIdentityKey(external)).toBe(
      'external-repo:https://github.com/acme/dots:abc123::community.review@0.1.0:skills/review'
    )
    expect(isSamePluginInstallSpecIdentity(registry, external)).toBe(false)
  })

  it('includes picked paths in external-repo identity keys', () => {
    const base: PluginInstallSpecIdentity = {
      kind: 'external-repo',
      repoUrl: 'https://github.com/acme/dots',
      commitSha: 'abc123',
      scanDigest: 'a'.repeat(64),
      pickedSignalPaths: ['skills/review'],
      pluginId: 'community.review',
      version: '0.1.0',
    }
    const otherPick: PluginInstallSpecIdentity = {
      ...base,
      pickedSignalPaths: ['prompts/review.md'],
    }

    expect(isSamePluginInstallSpecIdentity(base, otherPick)).toBe(false)
  })

  it('normalizes standalone registry artifact identities with registry URL and kind', () => {
    const identity = normalizeRegistryArtifactInstallSpecIdentity(
      'agentrig/community.review@0.1.0',
      'skill',
      '/repo',
      [{ name: 'agentrig', url: 'https://agentrig.ai/registry/' }],
    )
    const otherKind: PluginInstallSpecIdentity = {
      ...identity,
      artifactKind: 'mcp',
    }

    expect(identity).toEqual({
      kind: 'registry-artifact',
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      artifactKind: 'skill',
      artifactId: 'community.review',
      version: '0.1.0',
    })
    expect(getPluginInstallSpecIdentityKey(identity)).toBe(
      'registry-artifact:agentrig:https://agentrig.ai/registry:skill:community.review@0.1.0'
    )
    expect(isSamePluginInstallSpecIdentity(identity, otherKind)).toBe(false)
  })
})
