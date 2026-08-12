import { describe, expect, it } from 'vite-plus/test'
import { filterSignalsByKind, scanRepo } from '../../src/repo-scan/scan'
import { AGENT_PLUGIN_MANIFEST_SCHEMA_URL } from '../../src/agent-plugins'
import { createMemoryTree } from './memory-tree'

describe('scanRepo', () => {
  it('returns stable reports and digest over tier 1 signals only', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
      'prompts/explain.md': '# Explain',
      'README.md': '# Repo',
    })

    const first = await scanRepo({
      source: { type: 'virtual', label: 'fixture' },
      tree,
    })
    const second = await scanRepo({
      source: { type: 'virtual', label: 'fixture' },
      tree,
    })

    expect(first).toEqual(second)
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.signals.map((signal) => [signal.kind, signal.sourcePath])).toEqual([
      ['prompt', 'prompts/explain.md'],
      ['skill', 'skills/review'],
    ])
  })

  it('keeps filtering separate from canonical scan digest', async () => {
    const tree = createMemoryTree({
      'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
      'prompts/explain.md': '# Explain',
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })
    const skillsOnly = filterSignalsByKind(report.signals, ['skill'])

    expect(skillsOnly).toHaveLength(1)
    expect(skillsOnly[0].kind).toBe('skill')
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('lifts root AgentRig plugin identity into scan plugin candidates', async () => {
    const tree = createMemoryTree({
      'plugin.json': JSON.stringify({
        $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
        name: 'regenrek.test-submission',
        description: 'Reference plugin.',
        version: '0.2.0',
        author: { name: 'AgentRig' },
        extensions: {
          'ai.agentrig': {
            displayName: 'Test Submission',
            configSchema: {},
            pluginDependencies: [],
          },
        },
      }),
      'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })

    expect(report.pluginCandidates).toEqual([
      {
        artifactId: 'regenrek.test-submission',
        version: '0.2.0',
        sourcePath: '.',
        manifestPath: 'plugin.json',
        manifest: {
          $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
          name: 'regenrek.test-submission',
          description: 'Reference plugin.',
          version: '0.2.0',
          author: { name: 'AgentRig' },
          extensions: {
            'ai.agentrig': {
              displayName: 'Test Submission',
              configSchema: {},
              pluginDependencies: [],
            },
          },
        },
        diagnostics: [],
        conformance: { loadable: true, portable: true, publishable: true },
        manifestFile: {
          path: 'plugin.json',
          digest: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
          content: expect.stringContaining('regenrek.test-submission'),
        },
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'plugin.json' }),
          expect.objectContaining({ path: 'skills/review/SKILL.md' }),
        ]),
      },
    ])
  })

  it('uses nested AgentRig plugin manifests as plugin-root scoped candidates', async () => {
    const tree = createMemoryTree({
      'plugins/regenrek.agentic-engineer-core/plugin.json': JSON.stringify({
        $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
        name: 'regenrek.agentic-engineer-core',
        description: 'Agentic engineer core workflow skills.',
        version: '0.3.0',
        author: { name: 'Regenrek' },
        keywords: ['agentic', 'engineering'],
        extensions: {
          'ai.agentrig': {
            displayName: 'Agentic Engineer Core',
            configSchema: {},
            pluginDependencies: [],
          },
        },
      }),
      'plugins/regenrek.agentic-engineer-core/skills/review/SKILL.md': '---\nname: review\ndescription: Reviews code.\n---\nBody',
      'skills/standalone/SKILL.md': '---\nname: standalone\ndescription: Outside the plugin root.\n---\nBody',
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })

    expect(report.pluginCandidates).toEqual([
      expect.objectContaining({
        artifactId: 'regenrek.agentic-engineer-core',
        version: '0.3.0',
        sourcePath: 'plugins/regenrek.agentic-engineer-core',
        manifestPath: 'plugins/regenrek.agentic-engineer-core/plugin.json',
        diagnostics: [],
        conformance: { loadable: true, portable: true, publishable: true },
        manifest: expect.objectContaining({
          name: 'regenrek.agentic-engineer-core',
          description: 'Agentic engineer core workflow skills.',
          author: { name: 'Regenrek' },
          keywords: ['agentic', 'engineering'],
          extensions: expect.objectContaining({
            'ai.agentrig': expect.objectContaining({ displayName: 'Agentic Engineer Core' }),
          }),
        }),
        manifestFile: expect.objectContaining({
          path: 'plugins/regenrek.agentic-engineer-core/plugin.json',
          content: expect.stringContaining('regenrek.agentic-engineer-core'),
        }),
      }),
    ])
    expect(report.pluginCandidates[0].files.map((file) => file.path)).toEqual([
      'plugin.json',
      'skills/review/SKILL.md',
    ])
    expect(report.pluginCandidates[0].files.map((file) => file.path)).not.toContain('skills/standalone/SKILL.md')
  })

  it('isolates invalid ai.agentrig metadata while retaining the portable scan candidate', async () => {
    const tree = createMemoryTree({
      'plugin.json': JSON.stringify({
        $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
        name: 'acme.tools',
        extensions: {
          'ai.agentrig': {
            displayName: 'Acme Tools',
            listing: { category: 'Development' },
          },
        },
      }),
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })

    expect(report.pluginCandidates).toHaveLength(1)
    expect(report.pluginCandidates[0]).toMatchObject({
      artifactId: 'acme.tools',
      manifest: { name: 'acme.tools', extensions: undefined },
      conformance: { loadable: true, portable: true, publishable: false },
      diagnostics: [expect.objectContaining({ code: 'extension.ai-agentrig.invalid', publishBlocking: true })],
    })
  })

  it('does not treat unrelated or legacy plugin.json files as plugin candidates', async () => {
    const tree = createMemoryTree({
      'vendor/plugin.json': JSON.stringify({ name: 'grafana-panel-plugin' }),
      'vendor/skills/noise/SKILL.md': '---\nname: noise\ndescription: Not an Agent Plugin.\n---\nBody',
      '.plugin/plugin.json': JSON.stringify({
        $schema: 'https://agentrig.ai/schema/plugin.v1.json',
        name: 'legacy.plugin',
      }),
      '.plugin/skills/legacy/SKILL.md': '---\nname: legacy\ndescription: Legacy package.\n---\nBody',
    })

    const report = await scanRepo({ source: { type: 'virtual', label: 'fixture' }, tree })

    expect(report.pluginCandidates).toEqual([])
  })
})
