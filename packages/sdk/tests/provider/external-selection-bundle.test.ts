import { describe, expect, it } from 'vite-plus/test'
import { buildExternalSelectionBundle } from '../../src/provider/external-selection-bundle'
import { assertSelectionBundleInstallable } from '../../src/provider/selection-bundle'
import { scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from '../repo-scan/memory-tree'

describe('buildExternalSelectionBundle', () => {
  it('builds an installable external-repo-scan Selection Bundle from selected artifact paths', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
      'README.md': '# Repo',
    })
    const report = await scanRepo({ source: { type: 'virtual', label: 'owner/repo' }, tree })
    const result = await buildExternalSelectionBundle({
      tree,
      report,
      selectedSourcePaths: ['skills/review'],
      provider: 'cursor',
      scope: 'workspace',
      source: {
        kind: 'external-repo-scan',
        sourceLabel: 'owner/repo',
        owner: 'owner',
        repo: 'repo',
        scanDigest: report.digest,
      },
    })

    expect(result.bundle.source.kind).toBe('external-repo-scan')
    expect(result.bundle.selectedArtifacts.map((artifact) => artifact.selector)).toEqual(['skill:review'])
    expect(result.bundle.targetPaths).toEqual(['.cursor/skills/review/SKILL.md'])
    expect(() => assertSelectionBundleInstallable(result.bundle)).not.toThrow()
  })

  it('rejects selected docs because docs are not installable artifacts', async () => {
    const tree = createMemoryTree({
      'README.md': '# Repo',
    })
    const report = await scanRepo({ source: { type: 'virtual', label: 'owner/repo' }, tree })

    await expect(buildExternalSelectionBundle({
      tree,
      report,
      selectedSourcePaths: ['README.md'],
      provider: 'cursor',
      scope: 'workspace',
      source: {
        kind: 'external-repo-scan',
        sourceLabel: 'owner/repo',
        scanDigest: report.digest,
      },
    })).rejects.toThrow(/not an installable artifact/i)
  })

  it('closes a selected MCP over its complete inspected plugin package payload', async () => {
    const tree = createMemoryTree({
      'plugin.json': JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        name: 'acme.local-mcp',
      }),
      'mcp.json': JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: {
          local: {
            type: 'stdio',
            command: './scripts/server.mjs',
            args: ['--config', '${PLUGIN_ROOT}/config.json'],
          },
        },
      }),
      'scripts/server.mjs': 'process.stdin.resume()\n',
      'config.json': '{"enabled":true}\n',
    })
    const report = await scanRepo({ source: { type: 'virtual', label: 'owner/repo' }, tree })
    const result = await buildExternalSelectionBundle({
      tree,
      report,
      selectedSourcePaths: ['mcp.json'],
      provider: 'cursor',
      scope: 'workspace',
      source: {
        kind: 'external-repo-scan',
        sourceLabel: 'owner/repo',
        scanDigest: report.digest,
      },
    })

    expect(result.bundle.selectedArtifacts[0]).toMatchObject({ closureStatus: 'closed' })
    expect(result.bundle.materialization.fileCopies.map((copy) => copy.sourcePath)).toEqual([
      'config.json',
      'mcp.json',
      'plugin.json',
      'scripts/server.mjs',
    ])
    expect(result.bundle.materialization.jsonWrites[0]).toMatchObject({
      compileMcp: {
        pluginRoot: expect.stringContaining('/plugins/mcp'),
        pluginData: expect.stringContaining('/data/mcp'),
      },
    })
    expect(() => assertSelectionBundleInstallable(result.bundle)).not.toThrow()
  })

  it('keeps a local MCP blocked when its inspected package omits a referenced file', async () => {
    const tree = createMemoryTree({
      'plugin.json': JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        name: 'acme.incomplete-mcp',
      }),
      'mcp.json': JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: {
          local: {
            type: 'stdio',
            command: 'node',
            args: ['--config', '${PLUGIN_ROOT}/missing-config.json'],
          },
        },
      }),
    })
    const report = await scanRepo({ source: { type: 'virtual', label: 'owner/repo' }, tree })
    const result = await buildExternalSelectionBundle({
      tree,
      report,
      selectedSourcePaths: ['mcp.json'],
      provider: 'cursor',
      scope: 'workspace',
      source: {
        kind: 'external-repo-scan',
        sourceLabel: 'owner/repo',
        scanDigest: report.digest,
      },
    })

    expect(result.bundle.selectedArtifacts[0]).toMatchObject({
      closureStatus: 'requires-full-source',
      closureReason: expect.stringMatching(/missing referenced paths/i),
    })
    expect(result.bundle.selectedArtifacts[0]?.closureReason).toContain('missing-config.json')
    expect(() => assertSelectionBundleInstallable(result.bundle)).toThrow(/not closed/i)
  })
})
