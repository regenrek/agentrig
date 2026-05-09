import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  installArtifactSelection,
  uninstallArtifactSelection,
} from '../../src/lib/artifact-selection-install'
import { ensureDir, pathExists, writeJsonFile } from '../../src/lib/fs'
import { sha256Hex } from '../../src/lib/hash'
import {
  listSelectionInstallRecords,
  loadPluginInstallLedgers,
  upsertSelectionInstallRecords,
} from '../../src/lib/plugin-install-ledger'
import { installBundleSnapshotDigest } from '../../src/lib/registry'
import type { RegistryRef, SelectionInstallRecord } from '../../src/lib/types'
import type { InstallBundle } from '@agentrig/sdk'

const tempDirs: string[] = []
const registries: RegistryRef[] = [{ name: 'agentrig', url: 'https://agentrig.ai' }]

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('installArtifactSelection', () => {
  it('builds a standalone registry-artifact selection bundle without --pick', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-selection-test-'))
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'agentrig-standalone-artifact-'))
    tempDirs.push(cwd, artifactDir)
    const skillBody = '# Test skill\n'
    const manifest = {
      kind: 'agentrig:skill' as const,
      id: 'demo.review',
      name: 'Review',
      description: 'Review code.',
      version: '1.0.0',
      entry: 'SKILL.md',
    }
    await ensureDir(path.join(artifactDir, 'skills', 'review', '.skill'))
    await writeFile(path.join(artifactDir, 'skills', 'review', 'SKILL.md'), skillBody)
    await writeJsonFile(path.join(artifactDir, 'skills', 'review', '.skill', 'skill.json'), manifest)
    const resolved = standaloneSkill({
      skillDigest: sha256Text(skillBody),
      manifestDigest: sha256Text(JSON.stringify(manifest, null, 2) + '\n'),
    })

    const result = await installArtifactSelection({
      sourceKind: 'registry-artifact',
      cwd,
      provider: 'codex',
      requestedScope: 'workspace',
      scope: 'workspace',
      registryRef: 'agentrig/demo.review',
      resolved,
      pluginDir: artifactDir,
      dryRun: true,
    })

    expect(result.bundle.source).toMatchObject({
      kind: 'registry-artifact',
      artifactKind: 'skill',
      artifactId: 'demo.review',
      registryRef: 'agentrig/demo-review@1.0.0',
      version: '1.0.0',
    })
    expect(result.record.specIdentity).toMatchObject({
      kind: 'registry-artifact',
      artifactKind: 'skill',
      artifactId: 'demo.review',
      version: '1.0.0',
    })
    expect(result.record.pluginVersion).toBe('1.0.0')
    expect(result.record.snapshotDigest).toBe(installBundleSnapshotDigest(resolved))
    expect(result.record.selectedSelectors).toEqual(['skill:review'])
    expect(result.record.targetPaths).toEqual([
      path.join(cwd, '.codex', 'skills', 'review', '.skill', 'skill.json'),
      path.join(cwd, '.codex', 'skills', 'review', 'SKILL.md'),
    ])
  })
})

describe('uninstallArtifactSelection', () => {
  it('removes standalone registry-artifact skill installs without --pick', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-selection-test-'))
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'agentrig-standalone-artifact-'))
    tempDirs.push(cwd, artifactDir)
    const skillBody = '# Test skill\n'
    const manifest = {
      kind: 'agentrig:skill' as const,
      id: 'demo.review',
      name: 'Review',
      description: 'Review code.',
      version: '1.0.0',
      entry: 'SKILL.md',
    }
    await ensureDir(path.join(artifactDir, 'skills', 'review', '.skill'))
    await writeFile(path.join(artifactDir, 'skills', 'review', 'SKILL.md'), skillBody)
    await writeJsonFile(path.join(artifactDir, 'skills', 'review', '.skill', 'skill.json'), manifest)
    const resolved = standaloneSkill({
      skillDigest: sha256Text(skillBody),
      manifestDigest: sha256Text(JSON.stringify(manifest, null, 2) + '\n'),
    })
    const installResult = await installArtifactSelection({
      sourceKind: 'registry-artifact',
      cwd,
      provider: 'codex',
      requestedScope: 'workspace',
      scope: 'workspace',
      registryRef: 'agentrig/demo.review@1.0.0',
      resolved,
      pluginDir: artifactDir,
    })

    const result = await uninstallArtifactSelection({
      sourceKind: 'registry-artifact',
      cwd,
      provider: 'codex',
      source: 'agentrig/demo.review@1.0.0',
      registries,
      picks: [],
      defaultKind: 'skill',
      scope: 'workspace',
    })

    expect(result.kept).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.clearedRecordIds).toEqual([installResult.record.id])
    expect(result.removed.slice().sort()).toEqual(installResult.record.targetPaths.slice().sort())
    await expect(Promise.all(installResult.record.targetPaths.map((targetPath) => pathExists(targetPath)))).resolves.toEqual([
      false,
      false,
    ])
    const ledgers = await loadPluginInstallLedgers(cwd)
    expect(listSelectionInstallRecords(ledgers, 'workspace')).toEqual([])
  })

  it('treats an already-cleared selection uninstall as an idempotent no-op', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-selection-test-'))
    tempDirs.push(cwd)

    await expect(uninstallArtifactSelection({
      cwd,
      provider: 'codex',
      source: 'agentrig/demo.plugin@1.0.0',
      registries,
      picks: ['skill:review'],
      scope: 'workspace',
    })).resolves.toEqual({
      removed: [],
      kept: [],
      missing: [],
      clearedRecordIds: [],
    })
  })

  it('keeps user-modified JSON keys and reports them as kept modified', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agentrig-selection-test-'))
    tempDirs.push(cwd)
    const targetPath = path.join(cwd, '.codex', '.mcp.json')
    await ensureDir(path.dirname(targetPath))
    await writeJsonFile(targetPath, {
      mcpServers: {
        github: { command: 'node' },
      },
    })
    await upsertSelectionInstallRecords(cwd, 'workspace', [
      selectionRecord({
        targetPath,
        writtenValueSha256: digestJson({ github: { command: 'node' } }),
      }),
    ])
    await writeJsonFile(targetPath, {
      mcpServers: {
        github: { command: 'python' },
      },
    })

    const result = await uninstallArtifactSelection({
      cwd,
      provider: 'codex',
      source: 'agentrig/demo.plugin@1.0.0',
      registries,
      picks: ['mcp:mcp'],
      scope: 'workspace',
    })

    expect(result).toMatchObject({
      removed: [],
      missing: [],
      clearedRecordIds: [],
    })
    expect(result.kept).toEqual([`kept modified: ${targetPath}:mcpServers`])
  })

  it('refuses to uninstall selection files outside provider-owned roots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agentrig-selection-test-'))
    const cwd = path.join(root, 'workspace')
    tempDirs.push(root)
    await ensureDir(cwd)
    const outside = path.join(root, 'outside-selection.txt')
    await writeFile(outside, 'owned-by-user')
    await upsertSelectionInstallRecords(cwd, 'workspace', [
      {
        ...selectionRecord({
          targetPath: path.join(cwd, '.codex', '.mcp.json'),
          writtenValueSha256: digestJson({}),
        }),
        selectedSelectors: ['skill:review'],
        targetPaths: [outside],
        files: [{
          path: outside,
          sha256: `sha256:${sha256Hex(new TextEncoder().encode('owned-by-user'))}`,
        }],
        jsonWrites: [],
      },
    ])

    await expect(uninstallArtifactSelection({
      cwd,
      provider: 'codex',
      source: 'agentrig/demo.plugin@1.0.0',
      registries,
      picks: ['skill:review'],
      scope: 'workspace',
    })).rejects.toThrow(/Unsafe selection target path/)
    await expect(pathExists(outside)).resolves.toBe(true)
  })
})

function selectionRecord(input: { targetPath: string; writtenValueSha256: string }): SelectionInstallRecord {
  return {
    id: 'selection:codex:workspace:test',
    provider: 'codex',
    requestedScope: 'workspace',
    specIdentity: {
      kind: 'registry',
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      pluginId: 'demo.plugin',
      version: '1.0.0',
    },
    registry: {
      registryAlias: 'agentrig',
      registryUrl: 'https://agentrig.ai/registry',
      sourceRepository: 'https://github.com/agentrig/agentrig-registry',
      contractVersion: '1',
      generatedAt: '2026-04-25T00:00:00.000Z',
      signature: {
        algorithm: 'sha256-json-envelope',
        keyId: 'agentrig-registry',
        signedDigest: 'sha256:registry',
      },
    },
    scope: 'workspace',
    pluginId: 'demo.plugin',
    pluginVersion: '1.0.0',
    snapshotDigest: 'sha256:snapshot',
    selectionId: 'test',
    selectedSelectors: ['mcp:mcp'],
    targetPaths: [input.targetPath],
    installedAt: '2026-04-25T00:00:00.000Z',
    files: [],
    jsonWrites: [{
      path: input.targetPath,
      keyPath: 'mcpServers',
      writtenValueSha256: input.writtenValueSha256,
      keys: ['github'],
    }],
  }
}

function digestJson(value: unknown) {
  return `sha256:${sha256Hex(new TextEncoder().encode(stableJson(value)))}`
}

function sha256Text(value: string) {
  return `sha256:${sha256Hex(new TextEncoder().encode(value))}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (value != null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function standaloneSkill(input: { skillDigest: string; manifestDigest: string }): InstallBundle {
  const fileDigests = [
    { path: '.skill/skill.json', digest: input.manifestDigest },
    { path: 'SKILL.md', digest: input.skillDigest },
  ]
  const snapshotDigest = digestJson(fileDigests)
  const versionRecord = {
    version: '1.0.0',
    path: 'skills/demo/review/versions/1.0.0/',
    manifest: 'skills/demo/review/versions/1.0.0/.skill/skill.json',
    source: 'skills/demo/review/versions/1.0.0/AGENTRIG_SOURCE.json',
    lock: 'skills/demo/review/versions/1.0.0/AGENTRIG_LOCK.json',
    review: 'skills/demo/review/versions/1.0.0/AGENTRIG_REVIEW.json',
    trust_tier: 'reviewed' as const,
    installability: 'installable' as const,
    snapshot_digest: snapshotDigest,
    published_at: '2026-04-25T00:00:00.000Z',
  }
  return {
    schemaVersion: 1,
    listing: {
      kind: 'skill',
      origin: 'standalone',
      artifactId: 'demo.review',
      name: 'Review',
      description: 'Review code.',
      version: '1.0.0',
      source: 'registry',
      slug: 'demo-review',
      registryAlias: 'agentrig',
      registrySnapshotDigest: snapshotDigest,
      registrySourceRepository: 'https://github.com/agentrig/agentrig-registry',
      installability: 'available',
      publishedAt: Date.parse('2026-04-25T00:00:00.000Z'),
      updatedAt: Date.parse('2026-04-25T00:00:00.000Z'),
    },
    source: {
      type: 'registry',
      url: 'https://agentrig.ai',
    },
    file_list: [
      { path: 'skills/review/.skill/skill.json', sha256: input.manifestDigest.replace(/^sha256:/, ''), size: 1 },
      { path: 'skills/review/SKILL.md', sha256: input.skillDigest.replace(/^sha256:/, ''), size: 1 },
    ],
  }
}
