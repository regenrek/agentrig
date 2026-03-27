import { describe, expect, it } from 'vitest'
import {
  claudeMarketplaceManifestSchema,
  claudeMarketplacePluginSchema,
  claudePluginManifestSchema,
  codexMarketplaceManifestSchema,
  codexMarketplacePluginSchema,
  codexPluginManifestSchema,
  cursorMarketplaceManifestSchema,
  cursorMarketplacePluginSchema,
  cursorPluginManifestSchema,
} from '../../src/lib/plugin-providers/schemas'

describe('plugin provider schemas', () => {
  const claudePluginExample = {
    name: 'agentrig-core',
    description: 'Claude plugin example',
    version: '1.0.0',
    author: { name: 'Agentrig' },
    commands: ['./commands'],
    agents: ['./agents'],
  }

  const codexPluginExample = {
    name: 'agentrig-core',
    description: 'Codex plugin example',
    version: '1.0.0',
    author: { name: 'Agentrig' },
    skills: './skills/',
    mcpServers: './.mcp.json',
    apps: './.app.json',
    interface: {
      displayName: 'Agentrig Core',
      shortDescription: 'Reusable Codex setup',
      developerName: 'Agentrig',
      category: 'Productivity',
    },
  }

  const cursorPluginExample = {
    name: 'agentrig-core',
    description: 'Cursor plugin example',
    version: '1.0.0',
    author: { name: 'Agentrig' },
    rules: './rules',
    skills: './skills',
    agents: './agents',
    commands: './commands',
    hooks: './hooks/hooks.json',
    mcpServers: './mcp.json',
  }

  const claudeMarketplacePluginExample = {
    name: 'agentrig-core',
    source: 'agentrig-core',
    description: 'Claude marketplace entry',
    version: '1.0.0',
    tags: ['core'],
  }

  const codexMarketplacePluginExample = {
    name: 'agentrig-core',
    source: {
      source: 'local' as const,
      path: './plugins/agentrig-core',
    },
    policy: {
      installation: 'AVAILABLE' as const,
      authentication: 'ON_INSTALL' as const,
    },
    category: 'Productivity',
  }

  const cursorMarketplacePluginExample = {
    name: 'agentrig-core',
    source: 'plugins/agentrig-core',
    description: 'Cursor marketplace entry',
    version: '1.0.0',
    author: { name: 'Agentrig' },
    keywords: ['core'],
  }

  it('accepts valid provider plugin manifests', () => {
    expect(claudePluginManifestSchema.parse(claudePluginExample)).toEqual(claudePluginExample)
    expect(codexPluginManifestSchema.parse(codexPluginExample)).toEqual(codexPluginExample)
    expect(cursorPluginManifestSchema.parse(cursorPluginExample)).toEqual(cursorPluginExample)
  })

  it('accepts valid provider marketplace plugin entries', () => {
    expect(claudeMarketplacePluginSchema.parse(claudeMarketplacePluginExample)).toEqual(
      claudeMarketplacePluginExample
    )
    expect(codexMarketplacePluginSchema.parse(codexMarketplacePluginExample)).toEqual(
      codexMarketplacePluginExample
    )
    expect(cursorMarketplacePluginSchema.parse(cursorMarketplacePluginExample)).toEqual(
      cursorMarketplacePluginExample
    )
  })

  it('accepts valid provider marketplace manifests', () => {
    expect(
      claudeMarketplaceManifestSchema.parse({
        name: 'agentrig-community',
        owner: { name: 'Agentrig' },
        metadata: {
          description: 'Claude marketplace',
          version: '1.0.0',
          pluginRoot: './plugins',
        },
        plugins: [claudeMarketplacePluginExample],
      }).plugins[0]
    ).toEqual(claudeMarketplacePluginExample)

    expect(
      codexMarketplaceManifestSchema.parse({
        name: 'agentrig-local',
        interface: { displayName: 'Agentrig Local' },
        plugins: [codexMarketplacePluginExample],
      }).plugins[0]
    ).toEqual(codexMarketplacePluginExample)

    expect(
      cursorMarketplaceManifestSchema.parse({
        name: 'agentrig-marketplace',
        owner: { name: 'Agentrig' },
        metadata: {
          description: 'Cursor marketplace',
          version: '1.0.0',
          pluginRoot: 'plugins',
        },
        plugins: [cursorMarketplacePluginExample],
      }).plugins[0]
    ).toEqual(cursorMarketplacePluginExample)
  })

  it('captures the important provider differences', () => {
    expect('commands' in claudePluginExample).toBe(true)
    expect('interface' in codexPluginExample).toBe(true)
    expect('rules' in cursorPluginExample).toBe(true)

    expect(typeof claudeMarketplacePluginExample.source).toBe('string')
    expect(typeof cursorMarketplacePluginExample.source).toBe('string')
    expect(typeof codexMarketplacePluginExample.source).toBe('object')
  })
})
