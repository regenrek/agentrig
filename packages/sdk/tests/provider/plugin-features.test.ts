import { describe, expect, it } from 'vite-plus/test'
import { detectPluginFeatures } from '../../src'
import { createMemoryTree } from '../repo-scan/memory-tree'

describe('plugin feature detection', () => {
  it('detects provider plugin feature flags from the SDK virtual tree', async () => {
    const features = await detectPluginFeatures(
      createMemoryTree({
        'README.md': '# Plugin\n',
        'skills/review/SKILL.md': '---\nname: Review\ndescription: Reviews code.\n---\n',
        'commands/audit.md': '# Audit',
        'agents/research.md': '# Research',
        'rules/typescript.mdc': '# Rule',
        'hooks/hooks.json': '{}',
        'assets/icon.svg': '<svg />',
        'scripts/bootstrap.sh': 'echo ok',
        'settings.json': '{}',
        '.mcp.json': '{}',
        '.lsp.json': '{}',
        '.app.json': '{}',
      })
    )

    expect(features).toEqual({
      hasReadme: true,
      hasSkills: true,
      hasCommands: true,
      hasAgents: true,
      hasRules: true,
      hasHooks: true,
      hasAssets: true,
      hasScripts: true,
      hasSettings: true,
      hasClaudeMcp: true,
      hasClaudeLsp: true,
      hasCodexApp: true,
    })
  })
})
