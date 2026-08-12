import { describe, expect, it } from 'vite-plus/test'
import { runTier1Detectors } from '../../src/repo-scan/detectors'
import { createMemoryTree } from './memory-tree'

describe('tier 1 detectors', () => {
  it('detects structured provider-native files deterministically', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
        'packages/skills/lint.md': '---\nname: Lint\ndescription: Checks lint issues.\n---\nBody',
        'mcp.json': JSON.stringify({
          $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
          mcpServers: { fs: { type: 'stdio', command: 'node', args: ['server.js'] } },
        }),
        'hooks/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }] } }),
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
      ['hook', 'hooks/hooks.json'],
      ['mcp', 'mcp.json'],
      ['settings', 'settings.json'],
      ['skill', 'skills/review'],
    ])
    expect(signals.find((signal) => signal.kind === 'skill' && signal.sourcePath === 'skills/review')).toMatchObject({
      id: 'review',
      description: 'Reviews code.',
      providerCompat: { claude: 'native', codex: 'native', cursor: 'native' },
    })
    expect(signals.find((signal) => signal.kind === 'hook')).toMatchObject({
      id: 'hooks',
      sourcePath: 'hooks/hooks.json',
    })
    expect(signals.find((signal) => signal.kind === 'codex-app')?.providerCompat).toMatchObject({
      claude: 'unsupported',
      codex: 'native',
      cursor: 'unsupported',
    })
  })

  it('detects prompt and agent signals without treating arbitrary repo files as components', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'prompts/explain.md': '# Explain',
        'commands/rewrite.md': '# Rewrite',
        'agents/reviewer.md': '---\nname: Reviewer\ndescription: Reviews implementation plans.\n---\nBody',
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
      ['prompt', 'commands/rewrite.md'],
      ['prompt', 'prompts/explain.md'],
    ])
  })

  it('uses plugin manifests and marketplace sources as roots for path-based detectors', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        '.claude-plugin/marketplace.json': JSON.stringify({
          plugins: [{ name: 'compound', source: './plugins/compound' }],
        }),
        'plugins/compound/.claude-plugin/plugin.json': JSON.stringify({ name: 'compound', version: '1.0.0' }),
        'plugins/compound/.claude/commands/triage.md': '# Triage',
        'plugins/compound/agents/research/reviewer.md': '---\nname: Research Reviewer\ndescription: Reviews research.\n---\nBody',
        'plugins/compound/agents/research/no-frontmatter.md': '# Not an agent',
        'plugins/compound/commands/audit.md': '# Audit',
        'plugins/compound/prompts/explain.md': '# Explain',
        'plugins/compound/docs/usage.md': '# Usage',
        'agents/root.md': '---\nname: Root Agent\ndescription: Root-level agent.\n---\nBody',
        'skills/root/SKILL.md': '---\nname: root\ndescription: Root-level skill.\n---\nBody',
        'packages/random/prompts/loose.md': '# Loose',
      })
    )

    expect(signals.map((signal) => [signal.kind, signal.sourcePath])).toEqual([
      ['agent', 'agents/root.md'],
      ['command', 'plugins/compound/.claude/commands/triage.md'],
      ['agent', 'plugins/compound/agents/research/reviewer.md'],
      ['prompt', 'plugins/compound/commands/audit.md'],
      ['prompt', 'plugins/compound/prompts/explain.md'],
      ['skill', 'skills/root'],
    ])
    expect(signals.find((signal) => signal.sourcePath === 'plugins/compound/.claude/commands/triage.md')?.providerCompat).toMatchObject({
      claude: 'native',
      codex: 'port',
      cursor: 'port',
    })
  })

  it('rejects SKILL.md files with incomplete metadata', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'skills/bad/SKILL.md': '# Missing frontmatter\n\nStill a usable skill body.',
        'agents/no-frontmatter.md': '# Missing frontmatter',
        'packages/random/prompts/loose.md': '# Loose',
        'mcp.json': JSON.stringify({ nope: true }),
        'hooks/hooks.json': JSON.stringify({ PreToolUse: [] }),
        '.lsp.json': JSON.stringify({ servers: {} }),
        'settings.json': JSON.stringify({ nope: true }),
        '.cursor/rules/no-frontmatter.mdc': '# Rule',
      })
    )

    expect(signals).toEqual([])
  })

  it('ignores malformed deterministic inputs that have no canonical artifact path', async () => {
    const signals = await runTier1Detectors(
      createMemoryTree({
        'agents/no-frontmatter.md': '# Missing frontmatter',
        'packages/random/prompts/loose.md': '# Loose',
        'mcp.json': JSON.stringify({ nope: true }),
        'hooks/hooks.json': JSON.stringify({ PreToolUse: [] }),
        '.lsp.json': JSON.stringify({ servers: {} }),
        'settings.json': JSON.stringify({ nope: true }),
        '.cursor/rules/no-frontmatter.mdc': '# Rule',
      })
    )

    expect(signals).toEqual([])
  })
})
