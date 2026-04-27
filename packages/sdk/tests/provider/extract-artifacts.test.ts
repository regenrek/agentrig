import { describe, expect, it } from 'vite-plus/test'
import {
  detectArtifactClosure,
  extractArtifactsFromPluginLock,
  extractArtifactsFromRepoScan,
} from '../../src/provider/extract-artifacts'
import { scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from '../repo-scan/memory-tree'

describe('artifact extraction', () => {
  it('extracts bundled artifacts from a plugin lock', () => {
    const artifacts = extractArtifactsFromPluginLock({
      plugin: 'agentrig.core',
      version: '1.0.0',
      snapshot_digest: 'sha256:snapshot',
      capability_set: ['filesystem'],
      file_digests: [
        { path: '.plugin/plugin.json', digest: 'sha256:plugin' },
        { path: 'skills/review/SKILL.md', digest: 'sha256:skill' },
        { path: 'skills/review/references/rules.md', digest: 'sha256:rules' },
        { path: '.mcp.json', digest: 'sha256:mcp' },
        { path: 'hooks/hooks.json', digest: 'sha256:hooks' },
        { path: 'commands/summarize.md', digest: 'sha256:command' },
        { path: 'agents/research.md', digest: 'sha256:agent' },
      ],
    })

    expect(artifacts.map((artifact) => artifact.selector)).toEqual([
      'agent:research',
      'command:summarize',
      'hook:hooks',
      'mcp:mcp',
      'skill:review',
    ])
    expect(artifacts.find((artifact) => artifact.selector === 'skill:review')).toMatchObject({
      artifactId: 'agentrig.core#skill:review',
      parentArtifactId: 'agentrig.core',
      capabilitySet: ['filesystem'],
      paths: ['skills/review/SKILL.md', 'skills/review/references/rules.md'],
    })
  })

  it('extracts artifacts from repo scan signals', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
      '.mcp.json': JSON.stringify({ mcpServers: { fs: { command: 'node' } } }),
      'README.md': '# Repo',
    })
    const scan = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })
    const artifacts = extractArtifactsFromRepoScan(scan)

    expect(artifacts.map((artifact) => artifact.selector)).toEqual(['mcp:mcp', 'skill:review'])
    expect(artifacts[0].origin).toBe('standalone')
  })

  it('attaches only selector-scoped dependencies to bundled artifacts', () => {
    const artifacts = extractArtifactsFromPluginLock({
      plugin: 'agentrig.core',
      version: '1.0.0',
      snapshot_digest: 'sha256:snapshot',
      dependencies: [
        { kind: 'skill', artifact: 'shared' },
        { required_by: 'skill:review', kind: 'mcp', artifact: 'github' },
      ],
      file_digests: [
        { path: 'skills/review/SKILL.md', digest: 'sha256:review' },
        { path: 'skills/other/SKILL.md', digest: 'sha256:other' },
      ],
    })

    expect(artifacts.find((artifact) => artifact.selector === 'skill:review')?.dependencies).toEqual([
      { kind: 'mcp', selector: 'mcp:github' },
    ])
    expect(artifacts.find((artifact) => artifact.selector === 'skill:other')?.dependencies).toEqual([])
  })
})

describe('artifact closure', () => {
  it('marks self-contained artifacts as closed', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
    })
    const [artifact] = extractArtifactsFromPluginLock({
      plugin: 'agentrig.core',
      version: '1.0.0',
      snapshot_digest: 'sha256:snapshot',
      file_digests: [{ path: 'skills/review/SKILL.md', digest: 'sha256:skill' }],
    })

    await expect(detectArtifactClosure(tree, artifact)).resolves.toMatchObject({
      selector: 'skill:review',
      status: 'closed',
    })
  })

  it('requires full source for parent-directory references', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': 'Read ../shared/rules.md before reviewing.',
    })
    const [artifact] = extractArtifactsFromPluginLock({
      plugin: 'agentrig.core',
      version: '1.0.0',
      snapshot_digest: 'sha256:snapshot',
      file_digests: [{ path: 'skills/review/SKILL.md', digest: 'sha256:skill' }],
    })

    await expect(detectArtifactClosure(tree, artifact)).resolves.toMatchObject({
      status: 'requires-full-source',
      requiredPaths: ['skills/review/SKILL.md'],
    })
  })

  it('requires declared dependencies when selected artifacts are not closed over the bundle', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': 'Use the GitHub MCP.',
    })
    const [artifact] = extractArtifactsFromPluginLock({
      plugin: 'agentrig.core',
      version: '1.0.0',
      snapshot_digest: 'sha256:snapshot',
      dependencies: [
        { required_by: 'skill:review', kind: 'mcp', artifact: 'github' },
      ],
      file_digests: [{ path: 'skills/review/SKILL.md', digest: 'sha256:skill' }],
    })

    await expect(detectArtifactClosure(tree, artifact, { selectedSelectors: ['skill:review'] })).resolves.toMatchObject({
      status: 'requires-dependencies',
      requiredSelectors: ['mcp:github'],
    })
  })
})
