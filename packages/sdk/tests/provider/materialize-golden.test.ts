import { describe, expect, it } from 'vite-plus/test'
import { materializePlugin } from '../../src/provider/materialize'
import { scanRepo } from '../../src/repo-scan/scan'
import { createFixtureTree } from '../fixtures/fixture-tree'

describe('materializePlugin golden fixture', () => {
  it('stages selected dots-like signals into the canonical plugin layout', async () => {
    const tree = createFixtureTree('dots-like')
    const scan = await scanRepo({ source: { type: 'virtual', label: 'jxnl/dots-like' }, tree })
    const pickedSignals = scan.signals.filter((signal) =>
      ['.mcp.json', '.claude/commands/review.md', 'prompts/debug.md', 'skills/review'].includes(signal.sourcePath)
    )

    const files = await materializePlugin({
      tree,
      pickedSignals,
      manifest: {
        name: 'community.dots-like',
        displayName: 'Dots Like',
        description: 'Selected workflows from dots-like.',
        version: '1.0.0',
        category: 'Development',
        keywords: ['review', 'debug'],
        source: {
          repoUrl: 'https://github.com/jxnl/dots',
          owner: 'jxnl',
          repo: 'dots',
          commitSha: 'abc123',
          scanDigest: scan.digest,
        },
      },
    })

    expect(files.map((file) => file.path)).toEqual([
      '.mcp.json',
      '.plugin/plugin.json',
      'commands/debug.md',
      'commands/review.md',
      'skills/review/SKILL.md',
    ])

    const manifest = JSON.parse(decode(files.find((file) => file.path === '.plugin/plugin.json')?.bytes))
    expect(manifest['x-agentrig'].source).toMatchObject({
      kind: 'external-repo',
      repoUrl: 'https://github.com/jxnl/dots',
      owner: 'jxnl',
      repo: 'dots',
      commitSha: 'abc123',
      scanDigest: scan.digest,
      pickedSignalPaths: ['.claude/commands/review.md', '.mcp.json', 'prompts/debug.md', 'skills/review'],
    })
  })
})

function decode(bytes?: Uint8Array) {
  if (!bytes) throw new Error('Missing file bytes')
  return new TextDecoder().decode(bytes)
}
