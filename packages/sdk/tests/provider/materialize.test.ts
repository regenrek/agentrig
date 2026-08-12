import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vite-plus/test'
import { materializePlugin } from '../../src/provider/materialize'
import { scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from '../repo-scan/memory-tree'
import { AGENT_PLUGIN_MANIFEST_SCHEMA_URL, AGENT_PLUGIN_MCP_SCHEMA_URL } from '../../src/agent-plugins'

describe('materializePlugin', () => {
  it('stages picked signals into a bundle-valid AgentRig plugin layout', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
      'mcp.json': JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: { fs: { type: 'stdio', command: 'node' } },
      }),
      '.claude/commands/review.md': '# Review',
      '.cursor/rules/typescript.mdc': '---\ntitle: TypeScript\n---\nUse TS',
      'README.md': '# Repo',
    })
    const scan = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })
    const pickedSignals = scan.signals.filter((signal) =>
      ['skill', 'mcp', 'command', 'rule', 'doc'].includes(signal.kind)
    )

    const files = await materializePlugin({
      tree,
      pickedSignals,
      manifest: {
        name: 'community.review',
        displayName: 'Review',
        description: 'Review workflow.',
        version: '1.0.0',
        keywords: ['review'],
      },
    })

    expect(files.map((file) => file.path)).toEqual([
      'ai.agentrig/commands/review.md',
      'ai.agentrig/rules/typescript.mdc',
      'mcp.json',
      'plugin.json',
      'skills/review/SKILL.md',
    ])

    const manifest = JSON.parse(decode(files.find((file) => file.path === 'plugin.json')?.bytes))
    expect(manifest).toMatchObject({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'community.review',
      extensions: {
        'ai.agentrig': {
          displayName: 'Review',
        },
      },
    })
    expect(JSON.parse(decode(files.find((file) => file.path === 'mcp.json')?.bytes))).toEqual({
      $schema: AGENT_PLUGIN_MCP_SCHEMA_URL,
      mcpServers: { fs: { type: 'stdio', command: 'node' } },
    })
  })

  it('fails on conflicting destination paths', async () => {
    const tree = createMemoryTree({
      '.claude/commands/review.md': '# Claude',
      '.cursor/commands/review.md': '# Cursor',
    })
    const scan = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })

    await expect(
      materializePlugin({
        tree,
        pickedSignals: scan.signals,
        manifest: {
          name: 'community.review',
          displayName: 'Review',
          description: 'Review workflow.',
          version: '1.0.0',
        },
      })
    ).rejects.toThrow(/materialized path conflict/i)
  })

  it('fails when picked file bytes no longer match the scan digest', async () => {
    const scannedTree = createMemoryTree({
      '.claude/commands/review.md': '# Original',
    })
    const changedTree = createMemoryTree({
      '.claude/commands/review.md': '# Changed',
    })
    const scan = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree: scannedTree })

    await expect(
      materializePlugin({
        tree: changedTree,
        pickedSignals: scan.signals,
        manifest: {
          name: 'community.review',
          displayName: 'Review',
          description: 'Review workflow.',
          version: '1.0.0',
        },
      })
    ).rejects.toThrow(/changed after scan/i)
  })

  it('rejects weak MCP shapes instead of coercing them into the canonical contract', async () => {
    const content = JSON.stringify({
      mcpServers: {
        fs: { command: 'node', args: ['server.js'] },
      },
    })
    const tree = createMemoryTree({ 'mcp.json': content })

    await expect(materializePlugin({
      tree,
      pickedSignals: [{
        kind: 'mcp',
        id: 'mcp',
        title: 'MCP',
        sourcePath: 'mcp.json',
        files: [{
          path: 'mcp.json',
          sha256: createHash('sha256').update(content).digest('hex'),
          bytes: Buffer.byteLength(content),
        }],
        providerAffinity: { claude: 1, codex: 1, cursor: 1 },
        providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
        score: 1,
      }],
      manifest: {
        name: 'community.review',
        description: 'Review workflow.',
        version: '1.0.0',
      },
    })).rejects.toThrow(/invalid canonical mcp configuration/i)
  })
})

function decode(bytes?: Uint8Array) {
  if (!bytes) throw new Error('Missing file bytes')
  return new TextDecoder().decode(bytes)
}
