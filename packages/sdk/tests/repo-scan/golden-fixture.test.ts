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
          "agent",
          "agents/research.md",
          "Research",
        ],
        [
          "prompt",
          "commands/summarize.md",
          "Summarize",
        ],
        [
          "hook",
          "hooks.json",
          "Hooks",
        ],
        [
          "mcp",
          "mcp.json",
          "MCP Servers",
        ],
        [
          "prompt",
          "prompts/debug.md",
          "Debug",
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
    expect(first.digest).toMatchInlineSnapshot(`"fba89a837b44e9513b41d3a0b8cac3f2d43506a89edd43d52ded0b3a1740a83d"`)
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
          "mcp",
          "mcp",
          "mcp.json",
          {
            "claude": "native",
            "codex": "native",
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
