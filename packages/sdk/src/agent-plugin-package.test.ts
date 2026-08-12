import { describe, expect, it } from 'vitest'
import {
  AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
  AGENT_PLUGIN_MCP_SCHEMA_URL,
} from './agent-plugins'
import { inspectAgentPluginPackage } from './agent-plugin-package'

const manifest = {
  $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
  name: 'component-boundaries',
}

describe('Agent Plugin package component boundaries', () => {
  it('accepts only conforming Agent Skills and checks AgentRig references against them', () => {
    const result = inspectAgentPluginPackage({
      manifest: {
        ...manifest,
        extensions: {
          'ai.agentrig': {
            publicSkills: ['review'],
            supportSkills: ['missing'],
            aliases: { audit: 'wrong-directory' },
          },
        },
      },
      skills: [
        {
          path: 'skills/review/SKILL.md',
          content: '---\nname: review\ndescription: Reviews a change.\nmetadata:\n  audience: developers\n---\n# Review\n',
        },
        {
          path: 'skills/wrong-directory/SKILL.md',
          content: '---\nname: invented\ndescription: Does not match its directory.\n---\n# Invalid\n',
        },
        {
          path: 'skills/not-a-skill.md',
          content: '# A Markdown file is not an Agent Skill\n',
        },
      ],
    })

    expect(result.components.skills.map((skill) => skill.frontmatter.name)).toEqual(['review'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'skill.invalid',
      'skill.invalid',
      'extension.ai-agentrig.missing-skill',
      'extension.ai-agentrig.missing-skill',
    ])
    expect(result.conformance).toEqual({ loadable: true, portable: false, publishable: false })
  })

  it('disables an invalid MCP document but isolates an invalid server within a valid document', () => {
    const invalidDocument = inspectAgentPluginPackage({
      manifest,
      mcp: { path: 'mcp.json', content: '{not-json' },
    })
    const mixedDocument = inspectAgentPluginPackage({
      manifest,
      mcp: {
        path: 'mcp.json',
        content: JSON.stringify({
          $schema: AGENT_PLUGIN_MCP_SCHEMA_URL,
          mcpServers: {
            valid: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.js'] },
            invalid: { type: 'stdio', command: 'node server.js' },
          },
        }),
      },
    })

    expect(invalidDocument.components.mcpServers).toEqual([])
    expect(invalidDocument.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['mcp.invalid-document'])
    expect(mixedDocument.components.mcpServers.map((server) => server.name)).toEqual(['valid'])
    expect(mixedDocument.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['mcp.invalid-server'])
    expect(mixedDocument.conformance.loadable).toBe(true)
    expect(mixedDocument.conformance.publishable).toBe(false)
  })
})
