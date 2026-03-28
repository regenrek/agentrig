import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  buildResolvedPackSpecIdentityMap,
  normalizePluginInstallSpecIdentity,
} from '../../src/lib/plugin-install-spec'

describe('plugin-install-spec', () => {
  it('normalizes official pack specs to the official registry identity', () => {
    expect(normalizePluginInstallSpecIdentity('core-committer', '/repo', [])).toEqual({
      kind: 'registry',
      registryUrl: 'https://agentrig.ai/registry',
      packName: 'core-committer',
    })
  })

  it('prefers the configured official registry URL for plain official pack specs', () => {
    expect(
      normalizePluginInstallSpecIdentity('core-committer', '/repo', [
        { name: 'official', url: 'https://mirror.example.com/registry' },
      ])
    ).toEqual({
      kind: 'registry',
      registryUrl: 'https://mirror.example.com/registry',
      packName: 'core-committer',
    })
  })

  it('normalizes direct meta URLs through the URL serializer', () => {
    expect(
      normalizePluginInstallSpecIdentity('https://example.com/packs/core.json', '/repo', [])
    ).toEqual({
      kind: 'url',
      metaUrl: 'https://example.com/packs/core.json',
    })
  })

  it('normalizes local file specs to an absolute path', () => {
    expect(normalizePluginInstallSpecIdentity('.\\downloads\\meta.json', '/repo', [])).toEqual({
      kind: 'file',
      metaPath: path.normalize('/repo/downloads/meta.json'),
    })
  })

  it('builds per-pack identities from resolved packs', () => {
    expect(
      buildResolvedPackSpecIdentityMap([
        {
          meta: {
            name: 'core-committer',
            title: 'Core Committer',
            description: 'Commit helper',
            version: '1.0.0',
            files: [],
          },
          source: { type: 'url', baseUrl: 'https://agentrig.ai/registry' },
          sourceLabel: 'registry:official',
          trustTier: 'official',
          registry: { name: 'official', url: 'https://agentrig.ai/registry' },
        },
        {
          meta: {
            name: 'typescript-pack',
            title: 'TypeScript Pack',
            description: 'TS helper',
            version: '1.0.0',
            files: [],
          },
          source: { type: 'fs', baseDir: '/repo/downloads' },
          sourceLabel: 'file:/repo/downloads/meta.json',
        },
      ])
    ).toEqual({
      'core-committer': {
        kind: 'registry',
        registryUrl: 'https://agentrig.ai/registry',
        packName: 'core-committer',
      },
      'typescript-pack': {
        kind: 'file',
        metaPath: path.normalize('/repo/downloads/meta.json'),
      },
    })
  })
})
