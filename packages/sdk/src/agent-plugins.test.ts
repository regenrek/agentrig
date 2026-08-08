import { describe, expect, it } from 'vitest'
import {
  AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
  AGENT_PLUGIN_MCP_SCHEMA_URL,
  AgentPluginMcpConfigSchema,
  AgentPluginMcpDocumentSchema,
  AgentPluginMcpServerSchema,
  CAPABILITY_IDS,
  PluginManifestSchema,
  agentRigPluginExtension,
  pluginManifestListingCategory,
  resolvePluginSkillName,
} from './agent-plugins'

describe('Agent Plugins v1 manifest contract', () => {
  it('parses the canonical closed manifest and typed AgentRig extension', () => {
    const manifest = PluginManifestSchema.parse({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'instructa.core',
      version: 'release-channel-1',
      description: 'Reusable engineering skills.',
      author: { name: 'Instructa', url: 'https://instructa.ai' },
      extensions: {
        'ai.agentrig': {
          displayName: 'Instructa Core',
          kind: 'plugin',
          profile: 'core',
          listing: { category: 'Development' },
          publicSkills: ['project-spec-packager', 'duplicate-ownership-audit'],
          supportSkills: ['ship-gate'],
          aliases: { 'find-duplicate-ownership': 'duplicate-ownership-audit' },
          providerTargets: ['codex', 'claude-code', 'cursor'],
        },
        'com.example.client': { enabled: true },
      },
    })

    expect(agentRigPluginExtension(manifest)).toMatchObject({
      displayName: 'Instructa Core',
      profile: 'core',
      listing: { category: 'Development' },
    })
    expect(pluginManifestListingCategory(manifest)).toBe('Development')
    expect(resolvePluginSkillName(manifest, 'find-duplicate-ownership')).toEqual({
      plugin: 'instructa.core',
      requestedName: 'find-duplicate-ownership',
      canonicalName: 'duplicate-ownership-audit',
      matched: 'alias',
    })
    expect(resolvePluginSkillName(manifest, 'duplicate-ownership-audit')?.matched).toBe('canonical')
  })

  it('requires the canonical schema identifier and plugin name', () => {
    expect(() => PluginManifestSchema.parse({ name: 'instructa.core' })).toThrow()
    expect(() => PluginManifestSchema.parse({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'Instructa Core',
    })).toThrow()
  })

  it('ignores unknown portable fields and a non-object extensions field per v1 loading rules', () => {
    expect(PluginManifestSchema.parse({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'minimal-plugin',
      commands: { review: './commands/review.md' },
      extensions: 'invalid-but-ignored',
    })).toEqual({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'minimal-plugin',
    })
  })

  it('validates the implemented AgentRig namespace without closing capability ids', () => {
    expect(CAPABILITY_IDS).toContain('plan.ledger')
    const manifest = PluginManifestSchema.parse({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'third-party.custom-provider',
      extensions: {
        'ai.agentrig': {
          kind: 'plugin',
          providesCapabilities: {
            'custom.tool-chain': { type: 'tool', requiredByCore: false },
          },
          replacementPolicy: {
            capabilities: ['custom.tool-chain'],
            replaceWithoutCourseChange: true,
          },
        },
      },
    })
    expect(agentRigPluginExtension(manifest)?.providesCapabilities).toHaveProperty('custom.tool-chain')
  })
})

describe('Agent Plugins v1 MCP contract', () => {
  it('parses all portable server variants', () => {
    const config = AgentPluginMcpConfigSchema.parse({
      $schema: AGENT_PLUGIN_MCP_SCHEMA_URL,
      mcpServers: {
        local: {
          type: 'stdio',
          command: './bin/server',
          args: ['--data', '${PLUGIN_DATA}/local'],
          env: { CONFIG: '${PLUGIN_ROOT}/config.json' },
          cwd: '${PLUGIN_ROOT}',
        },
        remote: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: { 'X-Tenant': 'public' },
        },
        localHttp: {
          type: 'sse',
          url: 'http://127.0.0.1:3000/sse',
        },
      },
    })
    expect(Object.keys(config.mcpServers)).toEqual(['local', 'remote', 'localHttp'])
  })

  it('separates top-level loading from per-server validation', () => {
    const document = AgentPluginMcpDocumentSchema.parse({
      $schema: AGENT_PLUGIN_MCP_SCHEMA_URL,
      mcpServers: { valid: { type: 'stdio', command: 'node' }, invalid: { type: 'unknown' } },
    })
    expect(AgentPluginMcpServerSchema.safeParse(document.mcpServers.valid).success).toBe(true)
    expect(AgentPluginMcpServerSchema.safeParse(document.mcpServers.invalid).success).toBe(false)
  })

  it('enforces command, environment, header, and URL safety semantics', () => {
    expect(() => AgentPluginMcpServerSchema.parse({ type: 'stdio', command: 'node server.js' })).toThrow()
    expect(() => AgentPluginMcpServerSchema.parse({
      type: 'stdio',
      command: 'node',
      env: { PLUGIN_ROOT: '/tmp/override' },
    })).toThrow()
    expect(() => AgentPluginMcpServerSchema.parse({
      type: 'streamable-http',
      url: 'http://example.com/mcp',
    })).toThrow()
    expect(() => AgentPluginMcpServerSchema.parse({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'one', authorization: 'two' },
    })).toThrow()
  })
})
