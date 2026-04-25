import { describe, expect, it } from 'vite-plus/test'
import { materializePlugin } from '../../src/provider/materialize'
import { scanRepo } from '../../src/repo-scan/scan'
import { createMemoryTree } from '../repo-scan/memory-tree'

describe('materializePlugin', () => {
  it('stages picked signals into a bundle-valid AgentRig plugin layout', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
      '.mcp.json': JSON.stringify({ mcpServers: { fs: { command: 'node' } } }),
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
        id: 'community.review',
        name: 'Review',
        description: 'Review workflow.',
        version: '1.0.0',
        keywords: ['review'],
        source: {
          owner: 'owner',
          repo: 'repo',
          commitSha: 'abc123',
          scanDigest: scan.digest,
        },
      },
    })

    expect(files.map((file) => file.path)).toEqual([
      '.mcp.json',
      '.plugin/plugin.json',
      'commands/review.md',
      'README.md',
      'rules/typescript.mdc',
      'skills/review/SKILL.md',
    ])

    const manifest = JSON.parse(decode(files.find((file) => file.path === '.plugin/plugin.json')?.bytes))
    expect(manifest).toMatchObject({
      kind: 'agentrig:plugin',
      id: 'community.review',
      configSchema: {},
      'x-agentrig': {
        source: {
          kind: 'external-repo',
          owner: 'owner',
          repo: 'repo',
          commitSha: 'abc123',
          scanDigest: scan.digest,
          pickedSignalPaths: ['.claude/commands/review.md', '.cursor/rules/typescript.mdc', '.mcp.json', 'README.md', 'skills/review'],
        },
      },
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
          id: 'community.review',
          name: 'Review',
          description: 'Review workflow.',
          version: '1.0.0',
          source: { scanDigest: scan.digest },
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
          id: 'community.review',
          name: 'Review',
          description: 'Review workflow.',
          version: '1.0.0',
          source: { scanDigest: scan.digest },
        },
      })
    ).rejects.toThrow(/changed after scan/i)
  })
})

function decode(bytes?: Uint8Array) {
  if (!bytes) throw new Error('Missing file bytes')
  return new TextDecoder().decode(bytes)
}
