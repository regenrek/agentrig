import { describe, expect, it } from 'vite-plus/test'
import {
  buildPublishScanResult,
  buildPublishShapeCandidates,
  buildSubmitPublishPayload,
  normalizePublishSelectors,
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
    expect(payload.publishShape.selectedSelectors).toEqual(['mcp:mcp', 'skill:review'])
  })

  it('uses plugin identity lifted from the repo scan report', async () => {
    const report = await scanRepo({
      source: { type: 'virtual', label: 'fixture', ref: source.ref, commitSha: source.commitSha },
      tree: createMemoryTree({
        '.plugin/plugin.json': JSON.stringify({
          kind: 'agentrig:plugin',
          id: 'regenrek.test-submission',
          name: 'Test Submission',
          description: 'Reference plugin.',
          version: '0.2.0',
          configSchema: {},
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
      selectedSelectors: ['skill:review'],
    })
    expect(payload.enrichment).toEqual({ keywords: ['code', 'review'] })
  })

  it('builds deterministic submit payloads for selected plugin artifacts', async () => {
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
      requestedShape: 'plugin_selected',
      selectedSelectors: ['skill:review'],
      review: { provenanceVerified: true, ownershipVerified: true },
    })

    expect(payload.publishShape).toEqual({
      shape: 'plugin_selected',
      selectedSelectors: ['skill:review'],
    })
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

  it('blocks selected publish shapes when closure requires full source', async () => {
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
      ],
    })

    expect(() =>
      buildSubmitPublishPayload({
        source,
        scan,
        requestedShape: 'plugin_selected',
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
})
