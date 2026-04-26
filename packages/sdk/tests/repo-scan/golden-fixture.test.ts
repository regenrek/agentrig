import { describe, expect, it } from 'vite-plus/test'
import { buildEnrichmentPrompt, validateEnrichmentDraft } from '../../src/enrich/contract'
import { scanRepo } from '../../src/repo-scan/scan'
import { createFixtureTree } from '../fixtures/fixture-tree'

describe('dots-like golden fixture', () => {
  it('keeps scan signals and digest stable', async () => {
    const tree = createFixtureTree('dots-like')
    const first = await scanRepo({ source: { type: 'virtual', label: 'jxnl/dots-like' }, tree })
    const second = await scanRepo({ source: { type: 'virtual', label: 'jxnl/dots-like' }, tree })

    expect(first).toEqual(second)
    expect(first.signals.map((signal) => [signal.kind, signal.sourcePath, signal.title])).toMatchInlineSnapshot(`
      [
        [
          "codex-app",
          ".app.json",
          "Codex App",
        ],
        [
          "command",
          ".claude/commands/review.md",
          "Review",
        ],
        [
          "command",
          ".codex/prompts/commit.md",
          "Commit",
        ],
        [
          "command",
          ".cursor/commands/refactor.md",
          "Refactor",
        ],
        [
          "rule",
          ".cursor/rules/typescript.mdc",
          "TypeScript Boundary Rule",
        ],
        [
          "lsp",
          ".lsp.json",
          "Claude LSP",
        ],
        [
          "mcp",
          ".mcp.json",
          "MCP Servers",
        ],
        [
          "agent",
          "agents/research.md",
          "Research",
        ],
        [
          "asset",
          "assets/logo.txt",
          "Logo",
        ],
        [
          "prompt",
          "commands/summarize.md",
          "Summarize",
        ],
        [
          "doc",
          "docs/usage.md",
          "Usage",
        ],
        [
          "hook",
          "hooks.json",
          "Hooks",
        ],
        [
          "prompt",
          "prompts/debug.md",
          "Debug",
        ],
        [
          "doc",
          "README.md",
          "README",
        ],
        [
          "script",
          "scripts/bootstrap.sh",
          "Bootstrap",
        ],
        [
          "settings",
          "settings.json",
          "Settings",
        ],
        [
          "skill",
          "skills/debug",
          "Debug",
        ],
        [
          "skill",
          "skills/review",
          "Review",
        ],
      ]
    `)
    expect(first.digest).toMatchInlineSnapshot('"d5b571d32868b6f5bf9268d6a10da7cbe6d3e43c8d38d0849aa8522beed74755"')
  })

  it('keeps enrichment prompt evidence bounded and versioned', async () => {
    const tree = createFixtureTree('dots-like')
    const report = await scanRepo({ source: { type: 'virtual', label: 'jxnl/dots-like' }, tree })
    const prompt = buildEnrichmentPrompt({
      repoName: 'jxnl/dots-like',
      topLevelPaths: ['.claude', '.codex', '.cursor', 'agents', 'assets', 'commands', 'docs', 'prompts', 'scripts', 'skills'],
      readmeExcerpt: await tree.readText('README.md') ?? undefined,
      fieldsToFill: ['description', 'keywords', 'suggestedPluginId'],
      signals: report.signals,
    })

    expect(prompt.promptVersion).toBe('enrich-v1')
    const payload = JSON.parse(prompt.user) as {
      repoName: string
      topLevelPaths: string[]
      detectedSignals: Array<{ kind: string; id: string; sourcePath: string; providerCompat: Record<string, string> }>
      declaredFields: Record<string, unknown>
      readmeExcerpt: string
      fieldsToFill: string[]
    }
    expect(payload.repoName).toBe('jxnl/dots-like')
    expect(payload.topLevelPaths).toEqual(['.claude', '.codex', '.cursor', 'agents', 'assets', 'commands', 'docs', 'prompts', 'scripts', 'skills'])
    expect(payload.fieldsToFill).toEqual(['description', 'keywords', 'suggestedPluginId'])
    expect(payload.readmeExcerpt).toContain('Reusable agent workflows')
    expect(payload.detectedSignals.map((signal) => [signal.kind, signal.id, signal.sourcePath, signal.providerCompat])).toMatchInlineSnapshot(`
      [
        [
          "codex-app",
          "app",
          ".app.json",
          {
            "claude": "unsupported",
            "codex": "native",
            "cursor": "unsupported",
          },
        ],
        [
          "command",
          "claude-commands-review",
          ".claude/commands/review.md",
          {
            "claude": "native",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "command",
          "codex-prompts-commit",
          ".codex/prompts/commit.md",
          {
            "claude": "port",
            "codex": "native",
            "cursor": "port",
          },
        ],
        [
          "command",
          "cursor-commands-refactor",
          ".cursor/commands/refactor.md",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "native",
          },
        ],
        [
          "rule",
          "cursor-rules-typescript",
          ".cursor/rules/typescript.mdc",
          {
            "claude": "unsupported",
            "codex": "unsupported",
            "cursor": "native",
          },
        ],
        [
          "lsp",
          "lsp",
          ".lsp.json",
          {
            "claude": "native",
            "codex": "unsupported",
            "cursor": "unsupported",
          },
        ],
        [
          "mcp",
          "mcp",
          ".mcp.json",
          {
            "claude": "native",
            "codex": "native",
            "cursor": "native",
          },
        ],
        [
          "agent",
          "research",
          "agents/research.md",
          {
            "claude": "native",
            "codex": "unsupported",
            "cursor": "native",
          },
        ],
        [
          "asset",
          "assets-logo",
          "assets/logo.txt",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "prompt",
          "commands-summarize",
          "commands/summarize.md",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "doc",
          "docs-usage",
          "docs/usage.md",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "hook",
          "hooks",
          "hooks.json",
          {
            "claude": "native",
            "codex": "unsupported",
            "cursor": "native",
          },
        ],
        [
          "prompt",
          "prompts-debug",
          "prompts/debug.md",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "doc",
          "readme",
          "README.md",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "script",
          "scripts-bootstrap",
          "scripts/bootstrap.sh",
          {
            "claude": "port",
            "codex": "port",
            "cursor": "port",
          },
        ],
        [
          "settings",
          "settings",
          "settings.json",
          {
            "claude": "native",
            "codex": "unsupported",
            "cursor": "native",
          },
        ],
        [
          "skill",
          "debug",
          "skills/debug",
          {
            "claude": "native",
            "codex": "native",
            "cursor": "native",
          },
        ],
        [
          "skill",
          "review",
          "skills/review",
          {
            "claude": "native",
            "codex": "native",
            "cursor": "native",
          },
        ],
      ]
    `)
  })

  it('snapshots expected offline enrichment quality for the golden fixture', () => {
    const draft = validateEnrichmentDraft({
      description: 'Reusable agent workflows with skills, prompts, commands, hooks, MCP, and provider settings for Claude, Codex, and Cursor.',
      keywords: ['agent-workflows', 'skills', 'prompts', 'commands', 'mcp', 'claude', 'codex', 'cursor'],
      suggestedPluginId: 'community.dots-like',
    })

    expect(draft).toMatchInlineSnapshot(`
      {
        "draft": {
          "description": "Reusable agent workflows with skills, prompts, commands, hooks, MCP, and provider settings for Claude, Codex, and Cursor.",
          "keywords": [
            "agent-workflows",
            "skills",
            "prompts",
            "commands",
            "mcp",
            "claude",
            "codex",
            "cursor",
          ],
          "suggestedPluginId": "community.dots-like",
        },
        "ok": true,
      }
    `)
  })
})
