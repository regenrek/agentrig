import { describe, expect, it } from 'vite-plus/test'
import { runTier1Detectors } from '../../src/repo-scan/detectors'
import { createMemoryTree } from './memory-tree'

describe('tier 1 detectors', () => {
  it('detects structured provider-native files deterministically', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\nBody',
        '.mcp.json': JSON.stringify({ mcpServers: { fs: { command: 'node', args: ['server.js'] } } }),
        'hooks/hooks.json': JSON.stringify({ PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }] }),
        '.lsp.json': JSON.stringify({ languageServers: { typescript: { command: 'typescript-language-server', args: ['--stdio'] } } }),
        '.app.json': JSON.stringify({ entrypoint: './app.ts' }),
        'settings.json': JSON.stringify({ permissions: {} }),
        '.cursor/rules/typescript.mdc': '---\ntitle: TypeScript\ndescription: TS rules\n---\nUse TS',
        '.claude/commands/review.md': '# Review',
        '.codex/prompts/fix.md': '# Fix',
        '.cursor/commands/audit.md': '# Audit',
      })
    )

    expect(signals.map((signal) => [signal.kind, signal.sourcePath])).toEqual([
      ['codex-app', '.app.json'],
      ['command', '.claude/commands/review.md'],
      ['command', '.codex/prompts/fix.md'],
      ['command', '.cursor/commands/audit.md'],
      ['rule', '.cursor/rules/typescript.mdc'],
      ['lsp', '.lsp.json'],
      ['mcp', '.mcp.json'],
      ['hook', 'hooks/hooks.json'],
      ['settings', 'settings.json'],
      ['skill', 'skills/review'],
    ])
    expect(signals.find((signal) => signal.kind === 'skill')).toMatchObject({
      id: 'review',
      description: 'Reviews code.',
      providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
    })
    expect(signals.find((signal) => signal.kind === 'codex-app')?.providerCompat).toMatchObject({
      claude: 'unsupported',
      codex: 'native',
      cursor: 'unsupported',
    })
  })

  it('detects prompt, agent, script, asset, and doc path heuristics without duplicating structured files', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'prompts/explain.md': '# Explain',
        'commands/rewrite.md': '# Rewrite',
        'agents/reviewer.md': '# Reviewer',
        'scripts/bootstrap.sh': 'echo boot',
        'assets/icon.svg': '<svg />',
        'README.md': '# Repo',
        'docs/usage.md': '# Usage',
        '.claude/commands/review.md': '# Review',
      })
    )

    expect(signals.map((signal) => [signal.kind, signal.sourcePath])).toEqual([
      ['command', '.claude/commands/review.md'],
      ['agent', 'agents/reviewer.md'],
      ['asset', 'assets/icon.svg'],
      ['prompt', 'commands/rewrite.md'],
      ['doc', 'docs/usage.md'],
      ['prompt', 'prompts/explain.md'],
      ['doc', 'README.md'],
      ['script', 'scripts/bootstrap.sh'],
    ])
  })

  it('ignores malformed deterministic inputs', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'skills/bad/SKILL.md': '# Missing frontmatter',
        '.mcp.json': JSON.stringify({ nope: true }),
        'hooks/hooks.json': JSON.stringify({ PreToolUse: [] }),
        '.lsp.json': JSON.stringify({ servers: {} }),
        'settings.json': JSON.stringify({ nope: true }),
        '.cursor/rules/no-frontmatter.mdc': '# Rule',
      })
    )

    expect(signals).toEqual([])
  })
})
