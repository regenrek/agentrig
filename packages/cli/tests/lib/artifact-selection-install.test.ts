import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { uninstallArtifactSelection } from '../../src/lib/artifact-selection-install'
import { ensureDir, writeJsonFile } from '../../src/lib/fs'
import { sha256Hex } from '../../src/lib/hash'
import { upsertSelectionInstallRecords } from '../../src/lib/plugin-install-ledger'
import type { RegistryRef, SelectionInstallRecord } from '../../src/lib/types'

const tempDirs: string[] = []
const registries: RegistryRef[] = [{ name: 'agentrig', url: 'https://agentrig.ai/registry' }]

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('uninstallArtifactSelection', () => {
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
