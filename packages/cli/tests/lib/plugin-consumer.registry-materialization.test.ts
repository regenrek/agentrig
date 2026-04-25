import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  type ResolvedPluginGraph,
} from '../../src/lib/plugin-consumer'
import type { ResolvedPlugin } from '../../src/lib/registry'

const originalFetch = globalThis.fetch

function sha256Hex(input: string) {
  return createHash('sha256').update(Buffer.from(input)).digest('hex')
}

describe('plugin consumer registry materialization', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  function buildResolvedPlugin(files: Record<string, string>): ResolvedPlugin {
    const fileDigests = Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, body]) => ({
        path: filePath,
        digest: `sha256:${sha256Hex(body)}`,
      }))
    const snapshotDigest = `sha256:${createHash('sha256')
      .update(Buffer.from(JSON.stringify(fileDigests)))
      .digest('hex')}`
    return {
      manifest: {
        kind: 'agentrig:plugin',
        id: 'community.typescript',
        name: 'TypeScript skill',
        description: 'TypeScript patterns and guardrails.',
        version: '0.1.0',
        configSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
      },
      registryDocument: {
        contract_version: '1',
        registry_alias: 'agentrig',
        source_repository: 'https://github.com/agentrig/agentrig-registry',
        generated_at: '2026-04-16T11:00:00Z',
        signature: {
          algorithm: 'sha256-json-envelope',
          key_id: 'agentrig-registry',
          target: 'registry.json',
          signed_digest: 'sha256:registry',
        },
        items: [],
      },
      history: {
        kind: 'plugin',
        artifact: 'community.typescript',
        plugin: 'community.typescript',
        namespace: 'community',
        name: 'TypeScript skill',
        description: 'TypeScript patterns and guardrails.',
        latest_version: '0.1.0',
        trust_tier: 'reviewed',
        installability: 'installable',
        active_version: {
          version: '0.1.0',
          path: 'plugins/community/typescript/versions/0.1.0/',
          manifest: 'plugins/community/typescript/versions/0.1.0/.plugin/plugin.json',
          source: 'plugins/community/typescript/versions/0.1.0/AGENTRIG_SOURCE.json',
          lock: 'plugins/community/typescript/versions/0.1.0/AGENTRIG_LOCK.json',
          review: 'plugins/community/typescript/versions/0.1.0/AGENTRIG_REVIEW.json',
          trust_tier: 'reviewed',
          installability: 'installable',
          snapshot_digest: snapshotDigest,
          published_at: '2026-04-15T18:30:00Z',
        },
        versions: [],
      },
      versionRecord: {
        version: '0.1.0',
        path: 'plugins/community/typescript/versions/0.1.0/',
        manifest: 'plugins/community/typescript/versions/0.1.0/.plugin/plugin.json',
        source: 'plugins/community/typescript/versions/0.1.0/AGENTRIG_SOURCE.json',
        lock: 'plugins/community/typescript/versions/0.1.0/AGENTRIG_LOCK.json',
        review: 'plugins/community/typescript/versions/0.1.0/AGENTRIG_REVIEW.json',
        trust_tier: 'reviewed',
        installability: 'installable',
        snapshot_digest: snapshotDigest,
        published_at: '2026-04-15T18:30:00Z',
      },
      lockArtifact: {
        plugin: 'community.typescript',
        version: '0.1.0',
        file_digests: fileDigests,
        capability_set: [],
        declared_network_domains: [],
        declared_secrets: [],
        runtime_requirements: [],
        dependencies: [],
        snapshot_digest: snapshotDigest,
      },
      sourceArtifact: {
        upstream_repo: 'https://github.com/community-agents/typescript-skill',
        upstream_tag: 'v0.1.0',
        upstream_commit: '3333333333333333333333333333333333333333',
        plugin_path: 'plugin',
        submitted_by: 'community-review@agentrig.ai',
        snapshot_created_at: '2026-04-15T17:45:00Z',
        snapshot_tree_digest: snapshotDigest,
      },
      reviewArtifact: {
        review_status: 'approved',
        reviewer: 'AgentRig Community Review Team',
        reviewed_at: '2026-04-15T18:30:00Z',
        scanner_summary: { status: 'pass', findings: [] },
        policy_decisions: ['Approved for reviewed-tier installs.'],
        trust_tier_basis: {
          trust_tier: 'reviewed',
          installability: 'installable',
          rationale: 'Approved for reviewed-tier installs.',
        },
      },
      snapshotDigest,
      source: {
        type: 'url',
        baseUrl: 'https://agentrig.ai/registry/plugins/community/typescript/versions/0.1.0/',
      },
      sourceLabel: 'agentrig/community.typescript@0.1.0',
      trustTier: 'reviewed',
      installability: 'installable',
      registry: {
        name: 'agentrig',
        url: 'https://agentrig.ai/registry',
      },
    }
  }

  it('materializes digest-pinned registry files into a plugin source tree', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const pluginJson = JSON.stringify({
      kind: 'agentrig:plugin',
      id: 'community.typescript',
      name: 'TypeScript skill',
      description: 'TypeScript patterns and guardrails.',
      version: '0.1.0',
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    })
    const skill = '# TypeScript skill\n'
    const resolved = buildResolvedPlugin({
      '.plugin/plugin.json': pluginJson,
      'skills/typescript/SKILL.md': skill,
    })
    fetchMock
      .mockResolvedValueOnce(new Response(pluginJson, { status: 200 }))
      .mockResolvedValueOnce(new Response(skill, { status: 200 }))

    const graph = {
      requestedPlugin: resolved,
      resolvedPlugins: [resolved],
    } satisfies ResolvedPluginGraph

    const materialized = await materializeResolvedPluginGraph(graph)
    tempDirs.push(materialized.pluginsRoot)

    await expect(
      fs.readFile(path.join(materialized.pluginDir, 'skills', 'typescript', 'SKILL.md'), 'utf-8')
    ).resolves.toBe(skill)
    await expect(
      fs.readFile(path.join(materialized.pluginDir, '.plugin', 'plugin.json'), 'utf-8')
    ).resolves.toBe(pluginJson)
    await cleanupMaterializedPlugin(materialized.pluginsRoot)
  })

  it('fails when a fetched file does not match the locked digest', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const resolved = buildResolvedPlugin({
      '.plugin/plugin.json': '{"kind":"agentrig:plugin"}',
    })
    fetchMock.mockResolvedValueOnce(new Response('tampered', { status: 200 }))

    const graph = {
      requestedPlugin: resolved,
      resolvedPlugins: [resolved],
    } satisfies ResolvedPluginGraph

    await expect(materializeResolvedPluginGraph(graph)).rejects.toThrow(/digest mismatch/i)
  })
})
