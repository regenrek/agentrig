import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { resolvePluginFromRegistryRef } from '../../src/lib/registry'
import type { RegistryRef } from '../../src/lib/types'

const originalFetch = globalThis.fetch
const registry: RegistryRef = {
  name: 'agentrig',
  url: 'https://agentrig.ai/registry',
}
const pluginId = 'community.typescript'
const version = '0.1.0'

function sha256(input: string) {
  return `sha256:${createHash('sha256').update(Buffer.from(input)).digest('hex')}`
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeys(entry))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)])
  )
}

function digestJson(value: unknown) {
  return sha256(JSON.stringify(sortKeys(value)))
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function buildCanonicalArtifacts() {
  const manifest = {
    $schema: 'https://agentrig.ai/schema/plugin.v1.json',
    kind: 'agentrig:plugin' as const,
    id: pluginId,
    name: 'TypeScript skill',
    description: 'TypeScript patterns and guardrails.',
    version,
    keywords: ['typescript'],
    pluginDependencies: ['agentrig.security-check'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  }
  const skillBody = '# TypeScript skill\n'
  const lockFileDigests = [
    { path: '.plugin/plugin.json', digest: sha256(JSON.stringify(manifest)) },
    { path: 'skills/typescript/SKILL.md', digest: sha256(skillBody) },
  ]
  const snapshotDigest = digestJson(lockFileDigests)
  const versionRoot = `plugins/community/typescript/versions/${version}/`
  const versionRecord = {
    version,
    path: versionRoot,
    manifest: `${versionRoot}.plugin/plugin.json`,
    source: `${versionRoot}AGENTRIG_SOURCE.json`,
    lock: `${versionRoot}AGENTRIG_LOCK.json`,
    review: `${versionRoot}AGENTRIG_REVIEW.json`,
    trust_tier: 'reviewed',
    installability: 'installable',
    snapshot_digest: snapshotDigest,
    published_at: '2026-04-15T18:30:00Z',
  } as const
  const history = {
    $schema: 'https://agentrig.ai/schema/plugin-history.json',
    plugin: pluginId,
    namespace: 'community',
    name: 'TypeScript skill',
    description: 'TypeScript patterns and guardrails.',
    latest_version: version,
    trust_tier: 'reviewed',
    installability: 'installable',
    active_version: versionRecord,
    keywords: ['typescript'],
    versions: [versionRecord],
  }
  const registryPayload = {
    $schema: 'https://agentrig.ai/schema/registry.json',
    contract_version: '1',
    registry_alias: 'agentrig',
    source_repository: 'https://github.com/agentrig/agentrig-registry',
    generated_at: '2026-04-16T11:00:00Z',
    items: [
      {
        plugin: pluginId,
        name: 'TypeScript skill',
        description: 'TypeScript patterns and guardrails.',
        latest_version: version,
        history: 'plugins/community/typescript/plugin.json',
        active_version: versionRecord,
        trust_tier: 'reviewed',
        installability: 'installable',
        keywords: ['typescript'],
      },
    ],
  }
  const registryDocument = {
    ...registryPayload,
    signature: {
      algorithm: 'sha256-json-envelope',
      key_id: 'agentrig-registry',
      target: 'registry.json',
      signed_digest: digestJson(registryPayload),
    },
  }
  const lock = {
    $schema: 'https://agentrig.ai/schema/agentrig-lock.json',
    plugin: pluginId,
    version,
    file_digests: lockFileDigests,
    capability_set: [],
    declared_network_domains: [],
    declared_secrets: [],
    runtime_requirements: [],
    dependencies: [{ plugin: 'agentrig.security-check', version: '0.1.0' }],
    snapshot_digest: snapshotDigest,
  }
  const source = {
    $schema: 'https://agentrig.ai/schema/agentrig-source.json',
    upstream_repo: 'https://github.com/community-agents/typescript-skill',
    upstream_tag: 'v0.1.0',
    upstream_commit: '3333333333333333333333333333333333333333',
    plugin_path: 'plugin',
    submitted_by: 'community-review@agentrig.ai',
    snapshot_created_at: '2026-04-15T17:45:00Z',
    snapshot_tree_digest: snapshotDigest,
  }
  const review = {
    $schema: 'https://agentrig.ai/schema/agentrig-review.json',
    review_status: 'approved',
    reviewer: 'AgentRig Community Review Team',
    reviewed_at: '2026-04-15T18:30:00Z',
    scanner_summary: { status: 'pass', findings: [] },
    policy_decisions: ['Community plugin passed review.'],
    trust_tier_basis: {
      trust_tier: 'reviewed',
      installability: 'installable',
      rationale: 'Approved for reviewed-tier installs.',
    },
  }
  return { manifest, registryDocument, history, lock, source, review, snapshotDigest }
}

describe('registry resolution', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('resolves exact registry versions through signed registry and version artifacts', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const artifacts = buildCanonicalArtifacts()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(artifacts.registryDocument))
      .mockResolvedValueOnce(jsonResponse(artifacts.history))
      .mockResolvedValueOnce(jsonResponse(artifacts.manifest))
      .mockResolvedValueOnce(jsonResponse(artifacts.lock))
      .mockResolvedValueOnce(jsonResponse(artifacts.source))
      .mockResolvedValueOnce(jsonResponse(artifacts.review))

    const resolved = await resolvePluginFromRegistryRef(registry, pluginId, version)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://agentrig.ai/registry/registry.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://agentrig.ai/registry/plugins/community/typescript/plugin.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://agentrig.ai/registry/plugins/community/typescript/versions/0.1.0/.plugin/plugin.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://agentrig.ai/registry/plugins/community/typescript/versions/0.1.0/AGENTRIG_LOCK.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://agentrig.ai/registry/plugins/community/typescript/versions/0.1.0/AGENTRIG_SOURCE.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://agentrig.ai/registry/plugins/community/typescript/versions/0.1.0/AGENTRIG_REVIEW.json',
      expect.any(Object),
    )
    expect(resolved.source).toEqual({
      type: 'url',
      baseUrl: 'https://agentrig.ai/registry/plugins/community/typescript/versions/0.1.0/',
    })
    expect(resolved.trustTier).toBe('reviewed')
    expect(resolved.installability).toBe('installable')
    expect(resolved.snapshotDigest).toBe(artifacts.snapshotDigest)
    expect(resolved.lockArtifact.dependencies).toEqual([
      { plugin: 'agentrig.security-check', version: '0.1.0' },
    ])
  })

  it('fails when the signed registry digest does not match the unsigned payload', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const artifacts = buildCanonicalArtifacts()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...artifacts.registryDocument,
        signature: {
          ...artifacts.registryDocument.signature,
          signed_digest: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
      })
    )

    await expect(resolvePluginFromRegistryRef(registry, pluginId, version)).rejects.toThrow(
      /signature verification failed/i
    )
  })

  it('fails when the exact requested version is absent from plugin history', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const artifacts = buildCanonicalArtifacts()
    const modifiedRegistryPayload = {
      ...artifacts.registryDocument,
      items: [
        {
          ...artifacts.registryDocument.items[0],
          latest_version: '0.2.0',
          active_version: {
            ...artifacts.registryDocument.items[0].active_version,
            version: '0.2.0',
            path: 'plugins/community/typescript/versions/0.2.0/',
            manifest: 'plugins/community/typescript/versions/0.2.0/.plugin/plugin.json',
            source: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_SOURCE.json',
            lock: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_LOCK.json',
            review: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_REVIEW.json',
          },
        },
      ],
    }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ...modifiedRegistryPayload,
          signature: {
            ...modifiedRegistryPayload.signature,
            signed_digest: digestJson({
              $schema: modifiedRegistryPayload.$schema,
              contract_version: modifiedRegistryPayload.contract_version,
              registry_alias: modifiedRegistryPayload.registry_alias,
              source_repository: modifiedRegistryPayload.source_repository,
              generated_at: modifiedRegistryPayload.generated_at,
              items: modifiedRegistryPayload.items,
            }),
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...artifacts.history,
          latest_version: '0.2.0',
          active_version: {
            ...artifacts.history.active_version,
            version: '0.2.0',
            path: 'plugins/community/typescript/versions/0.2.0/',
            manifest: 'plugins/community/typescript/versions/0.2.0/.plugin/plugin.json',
            source: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_SOURCE.json',
            lock: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_LOCK.json',
            review: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_REVIEW.json',
          },
          versions: [
            {
              ...artifacts.history.active_version,
              version: '0.2.0',
              path: 'plugins/community/typescript/versions/0.2.0/',
              manifest: 'plugins/community/typescript/versions/0.2.0/.plugin/plugin.json',
              source: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_SOURCE.json',
              lock: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_LOCK.json',
              review: 'plugins/community/typescript/versions/0.2.0/AGENTRIG_REVIEW.json',
            },
          ],
        })
      )

    await expect(resolvePluginFromRegistryRef(registry, pluginId, version)).rejects.toThrow(
      /unknown version/i
    )
  })
})
