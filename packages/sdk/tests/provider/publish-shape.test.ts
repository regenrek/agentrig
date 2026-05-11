import { describe, expect, it } from 'vitest'
import {
  buildPublishScanResult,
  buildPublishShapeCandidates,
  buildSubmitPublishPayload,
  normalizePublishSelectors,
  PUBLISH_SHAPE_DEFINITIONS,
  PUBLISH_SHAPE_KINDS,
  type PublishPluginCandidate,
  type SubmitSource,
} from '../../src/provider/publish-shape'
import { scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from '../repo-scan/memory-tree'

const source: SubmitSource = {
  repoUrl: 'https://github.com/acme/tools',
  owner: 'acme',
  repo: 'tools',
  ref: 'v1.0.0',
  commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
}

const pluginCandidate: PublishPluginCandidate = {
  artifactId: 'acme.tools',
  version: '1.0.0',
  sourcePath: '.',
  manifestPath: '.plugin/plugin.json',
  manifest: {
    name: 'acme.tools',
    version: '1.0.0',
    description: 'Acme tools.',
    author: { name: 'Acme' },
    'x-agentrig': {
      displayName: 'Acme Tools',
      kind: 'plugin',
      configSchema: {},
      pluginDependencies: [],
    },
  },
  manifestFile: {
    path: '.plugin/plugin.json',
    digest: 'sha256:plugin',
    bytes: 42,
    content: '{"name":"acme.tools","version":"1.0.0"}',
  },
  files: [{ path: '.plugin/plugin.json', digest: 'sha256:plugin' }],
}

async function scanFixture() {
  return await scanRepo({
    source: { type: 'virtual', label: 'fixture', ref: source.ref, commitSha: source.commitSha },
    tree: createMemoryTree({
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
      '.mcp.json': JSON.stringify({ mcpServers: { github: { command: 'node' } } }),
      'README.md': '# Tools',
    }),
  })
}

describe('publish shape primitives', () => {
  it('defines labels and descriptions for every publish shape', () => {
    expect(Object.keys(PUBLISH_SHAPE_DEFINITIONS).sort()).toEqual([...PUBLISH_SHAPE_KINDS].sort())
    for (const shape of PUBLISH_SHAPE_KINDS) {
      expect(PUBLISH_SHAPE_DEFINITIONS[shape]).toMatchObject({ id: shape })
      expect(PUBLISH_SHAPE_DEFINITIONS[shape].label.trim()).not.toBe('')
      expect(PUBLISH_SHAPE_DEFINITIONS[shape].description.trim()).not.toBe('')
    }
  })

  it('defaults to plugin_all when a plugin candidate exists', async () => {
    const scan = buildPublishScanResult({
      source,
      report: await scanFixture(),
      scannerVersion: 'repo-scan-v1',
      treeSha: 'tree-sha',
      pluginCandidate,
    })

    const candidates = buildPublishShapeCandidates(scan)

    expect(candidates.find((candidate) => candidate.defaultSelected)?.shape).toBe('plugin_all')
    expect(candidates.find((candidate) => candidate.shape === 'plugin_all')).toMatchObject({
      allowed: true,
      produces: [{ kind: 'plugin', artifactId: 'acme.tools', installability: 'installable' }],
    })

    const payload = buildSubmitPublishPayload({
      source,
      scan,
      requestedShape: 'plugin_all',
      selectedSelectors: ['skill:review'],
      review: { provenanceVerified: true, ownershipVerified: true },
    })
    expect(payload.publishShape.includedSelectors).toEqual(['mcp:mcp', 'skill:review'])
    expect(candidates.find((candidate) => candidate.shape === 'generated_plugin')).toMatchObject({
      allowed: false,
      blockedReason: expect.stringMatching(/no \.plugin\/plugin\.json/i),
    })
  })

  it('scopes plugin_all default selectors to the detected plugin root', async () => {
    const report = await scanRepo({
      source: { type: 'virtual', label: 'fixture', ref: source.ref, commitSha: source.commitSha },
      tree: createMemoryTree({
        'plugins/regenrek.agentic-engineer-core/.plugin/plugin.json': JSON.stringify({
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          name: 'regenrek.agentic-engineer-core',
          description: 'Agentic engineer core workflow skills.',
          version: '0.3.0',
          author: { name: 'Regenrek' },
          keywords: ['agentic', 'engineering'],
          'x-agentrig': {
            displayName: 'Agentic Engineer Core',
            kind: 'plugin',
            configSchema: {},
            pluginDependencies: [],
          },
        }),
        'plugins/regenrek.agentic-engineer-core/skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
        'skills/standalone/SKILL.md': '---\nname: Standalone\ndescription: Outside plugin root.\n---\nBody',
      }),
    })
    const scan = buildPublishScanResult({
      source,
      report,
      scannerVersion: 'repo-scan-v1',
    })

    const pluginAll = buildPublishShapeCandidates(scan)
      .find((candidate) => candidate.shape === 'plugin_all')
    const payload = buildSubmitPublishPayload({
      source,
      scan,
      requestedShape: 'plugin_all',
      review: { provenanceVerified: true, ownershipVerified: true },
    })

    expect(pluginAll?.includedSelectors).toEqual(['skill:review'])
    expect(pluginAll?.includedSelectors).not.toContain('skill:standalone')
    expect(payload.publishShape.includedSelectors).toEqual(['skill:review'])
  })

  it('uses plugin identity lifted from the repo scan report', async () => {
    const report = await scanRepo({
      source: { type: 'virtual', label: 'fixture', ref: source.ref, commitSha: source.commitSha },
      tree: createMemoryTree({
        '.plugin/plugin.json': JSON.stringify({
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          name: 'regenrek.test-submission',
          description: 'Reference plugin.',
          version: '0.2.0',
          author: { name: 'AgentRig' },
          'x-agentrig': {
            displayName: 'Test Submission',
            kind: 'plugin',
            configSchema: {},
            pluginDependencies: [],
          },
        }),
        'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
      }),
    })

    const scan = buildPublishScanResult({
      source,
      report,
      scannerVersion: 'repo-scan-v1',
    })

    expect(scan.pluginCandidate).toMatchObject({
      artifactId: 'regenrek.test-submission',
      version: '0.2.0',
      sourcePath: '.',
      manifestPath: '.plugin/plugin.json',
      manifest: {
        name: 'regenrek.test-submission',
        version: '0.2.0',
        description: 'Reference plugin.',
        author: { name: 'AgentRig' },
      },
      manifestFile: {
        path: '.plugin/plugin.json',
        content: expect.stringContaining('regenrek.test-submission'),
      },
    })
    expect(scan.pluginCandidate?.files.map((file) => file.path)).toEqual([
      '.plugin/plugin.json',
      'skills/review/SKILL.md',
    ])
  })

  it('builds deterministic submit payloads for selected standalone artifacts', async () => {
    const scan = buildPublishScanResult({
      source,
      report: await scanFixture(),
      scannerVersion: 'repo-scan-v1',
      closures: [
        {
          selector: 'skill:review',
          status: 'closed',
          requiredSelectors: [],
          requiredPaths: [],
        },
      ],
    })

    const payload = buildSubmitPublishPayload({
      source,
      scan,
      requestedShape: 'standalone_artifacts',
      selectedSelectors: ['skill:review'],
      enrichment: { keywords: ['review', 'review', 'code'] },
      review: { provenanceVerified: true, ownershipVerified: false },
    })

    expect(payload.publishShape).toEqual({
      shape: 'standalone_artifacts',
      includedSelectors: ['skill:review'],
    })
    expect(payload.enrichment).toEqual({ keywords: ['code', 'review'] })
  })

  it('builds deterministic submit payloads for generated plugin artifacts', async () => {
    const scan = buildPublishScanResult({
      source,
      report: await scanFixture(),
      scannerVersion: 'repo-scan-v1',
      closures: [
        {
          selector: 'skill:review',
          status: 'closed',
          requiredSelectors: [],
          requiredPaths: [],
        },
      ],
    })

    const payload = buildSubmitPublishPayload({
      source,
      scan,
      requestedShape: 'generated_plugin',
      selectedSelectors: ['skill:review'],
      review: { provenanceVerified: true, ownershipVerified: true },
    })

    expect(payload.publishShape).toEqual({
      shape: 'generated_plugin',
      includedSelectors: ['skill:review'],
    })
    expect(payload.transformPlan).toMatchObject({
      requestedSelectors: ['skill:review'],
      includedSelectors: ['skill:review'],
      skipped: [],
    })
    expect(payload.scan.pluginCandidate).toBeUndefined()
    expect(buildPublishShapeCandidates(scan, ['skill:review']).find((candidate) => candidate.shape === 'generated_plugin')?.produces).toEqual([
      { kind: 'plugin', artifactId: 'acme.tools', installability: 'installable' },
    ])
  })

  it('rejects duplicate and unknown selected selectors', async () => {
    const scan = buildPublishScanResult({
      source,
      report: await scanFixture(),
      scannerVersion: 'repo-scan-v1',
    })

    expect(() => normalizePublishSelectors(['skill:review', 'skill:Review'], scan.artifacts)).toThrow(/duplicate/i)
    expect(() => normalizePublishSelectors(['skill:missing'], scan.artifacts)).toThrow(/unknown/i)
  })

  it('skips non-portable artifacts when generating a plugin', async () => {
    const report = await scanFixture()
    const scan = buildPublishScanResult({
      source,
      report,
      scannerVersion: 'repo-scan-v1',
      closures: [
        {
          selector: 'skill:review',
          status: 'requires-full-source',
          requiredSelectors: [],
          requiredPaths: ['skills/review/SKILL.md'],
          reason: 'References shared parent paths.',
        },
        {
          selector: 'mcp:mcp',
          status: 'closed',
          requiredSelectors: [],
          requiredPaths: [],
        },
      ],
    })

    const payload = buildSubmitPublishPayload({
      source,
      scan,
      requestedShape: 'generated_plugin',
      selectedSelectors: ['skill:review', 'mcp:mcp'],
      review: { provenanceVerified: true, ownershipVerified: true },
    })

    expect(payload.publishShape).toEqual({
      shape: 'generated_plugin',
      includedSelectors: ['mcp:mcp'],
    })
    expect(payload.transformPlan).toMatchObject({
      requestedSelectors: ['mcp:mcp', 'skill:review'],
      includedSelectors: ['mcp:mcp'],
      skipped: [{
        selector: 'skill:review',
        status: 'requires-full-source',
        requiredPaths: ['skills/review/SKILL.md'],
      }],
    })
    expect(buildPublishShapeCandidates(scan, ['skill:review']).find((candidate) => candidate.shape === 'generated_plugin')).toMatchObject({
      allowed: false,
      transformPlan: {
        requestedSelectors: ['skill:review'],
        includedSelectors: [],
        skipped: [{
          selector: 'skill:review',
          status: 'requires-full-source',
          requiredPaths: ['skills/review/SKILL.md'],
        }],
      },
    })
    expect(() =>
      buildSubmitPublishPayload({
        source,
        scan,
        requestedShape: 'standalone_artifacts',
        selectedSelectors: ['skill:review'],
        review: { provenanceVerified: true, ownershipVerified: true },
      })
    ).toThrow(/requires closed artifacts/i)
  })

  it('fails selected publish shapes closed when closure was not evaluated', async () => {
    const scan = buildPublishScanResult({
      source,
      report: await scanFixture(),
      scannerVersion: 'repo-scan-v1',
    })

    expect(() =>
      buildSubmitPublishPayload({
        source,
        scan,
        requestedShape: 'standalone_artifacts',
        selectedSelectors: ['skill:review'],
        review: { provenanceVerified: true, ownershipVerified: true },
      })
    ).toThrow(/requires closed artifacts/i)
  })

  it('skips generated plugin artifacts that would materialize to the same target path', () => {
    const scan = buildPublishScanResult({
      source,
      report: {
        digest: 'b'.repeat(64),
        signals: [
          {
            kind: 'mcp',
            id: 'mcp',
            title: 'Root MCP',
            sourcePath: '.mcp.json',
            files: [{ path: '.mcp.json', sha256: 'a'.repeat(64), bytes: 20 }],
            providerAffinity: { claude: 1, codex: 1, cursor: 1 },
            providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
            score: 1,
          },
          {
            kind: 'mcp',
            id: 'github',
            title: 'GitHub MCP',
            sourcePath: 'mcps/github',
            files: [{ path: 'mcps/github/config.json', sha256: 'c'.repeat(64), bytes: 20 }],
            providerAffinity: { claude: 1, codex: 1, cursor: 1 },
            providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
            score: 1,
          },
        ],
      },
      scannerVersion: 'repo-scan-v1',
      closures: [
        { selector: 'mcp:mcp', status: 'closed', requiredSelectors: [], requiredPaths: [] },
        { selector: 'mcp:github', status: 'closed', requiredSelectors: [], requiredPaths: [] },
      ],
    })

    const candidate = buildPublishShapeCandidates(scan, ['mcp:mcp', 'mcp:github'])
      .find((item) => item.shape === 'generated_plugin')
    expect(candidate).toMatchObject({
      allowed: true,
      transformPlan: {
        includedSelectors: ['mcp:github'],
        skipped: [{
          selector: 'mcp:mcp',
          reason: expect.stringContaining('Materialized path conflict'),
        }],
      },
    })
  })

  it('skips a generated plugin artifact whose own files conflict on one target path', () => {
    const scan = buildPublishScanResult({
      source,
      report: {
        digest: 'd'.repeat(64),
        signals: [
          {
            kind: 'mcp',
            id: 'mcp',
            title: 'MCP Servers',
            sourcePath: 'mcps',
            files: [
              { path: 'mcps/a.json', sha256: 'a'.repeat(64), bytes: 20 },
              { path: 'mcps/b.json', sha256: 'b'.repeat(64), bytes: 20 },
            ],
            providerAffinity: { claude: 1, codex: 1, cursor: 1 },
            providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
            score: 1,
          },
          {
            kind: 'skill',
            id: 'review',
            title: 'Review',
            sourcePath: 'skills/review',
            files: [{ path: 'skills/review/SKILL.md', sha256: 'c'.repeat(64), bytes: 20 }],
            providerAffinity: { claude: 1, codex: 1, cursor: 1 },
            providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
            score: 1,
          },
        ],
      },
      scannerVersion: 'repo-scan-v1',
      closures: [
        { selector: 'mcp:mcp', status: 'closed', requiredSelectors: [], requiredPaths: [] },
        { selector: 'skill:review', status: 'closed', requiredSelectors: [], requiredPaths: [] },
      ],
    })

    const candidate = buildPublishShapeCandidates(scan, ['mcp:mcp', 'skill:review'])
      .find((item) => item.shape === 'generated_plugin')
    expect(candidate).toMatchObject({
      allowed: true,
      transformPlan: {
        includedSelectors: ['skill:review'],
        skipped: [{
          selector: 'mcp:mcp',
          reason: expect.stringContaining('inside mcp:mcp'),
        }],
      },
    })
  })
})
