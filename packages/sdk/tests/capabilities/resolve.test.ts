import { describe, expect, it } from 'vitest'
import {
  AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
  agentRigPluginExtension,
  capabilityResolutionToJson,
  parseCapabilityPluginRef,
  resolveCapabilityGraph,
  type CapabilityPluginLoader,
  type CapabilityPluginRecord,
  type AgentRigPluginExtension,
} from '../../src'

const NOW = '2026-06-04T00:00:00.000Z'

describe('capability resolver', () => {
  it('resolves dependency closure, required providers, compatibility, constraints, and JSON output', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'agentrig/instructa.saas@1.0.0',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.saas', {
          pluginDependencies: [
            'agentrig/instructa.base@^1.0.0',
            'agentrig/third-party.context7@^1.0.0',
          ],
          requiredCapabilities: {
            'docs.latest': { required: true, provider: 'third-party.context7' },
          },
        }),
        basePlugin('instructa.base'),
        providerPlugin('third-party.context7', 'docs.latest', {
          providerTargets: ['codex', 'claude-code', 'cursor'],
          installConstraints: {
            common: ['network access to package docs'],
            codex: ['CONTEXT7_API_KEY is optional for higher rate limits'],
          },
        }),
      ]),
    })

    expect(result.ok).toBe(true)
    expect(result.pluginTree).toMatchObject({
      plugin: 'instructa.saas',
      dependencies: [
        { plugin: 'instructa.base' },
        { plugin: 'third-party.context7' },
      ],
    })
    expect(result.requiredCapabilities).toEqual([
      expect.objectContaining({
        capability: 'docs.latest',
        required: true,
        requestedProvider: 'third-party.context7',
        requiringPlugin: 'instructa.saas',
      }),
    ])
    expect(result.chosenProviders).toEqual([
      expect.objectContaining({
        capability: 'docs.latest',
        plugin: 'third-party.context7',
        required: true,
        stale: false,
        compatibility: { codex: 'native', 'claude-code': 'native', cursor: 'native' },
        installConstraints: {
          common: ['network access to package docs'],
          codex: ['CONTEXT7_API_KEY is optional for higher rate limits'],
        },
      }),
    ])
    expect(JSON.parse(JSON.stringify(capabilityResolutionToJson(result)))).toMatchObject({
      schemaVersion: 1,
      ok: true,
      chosenProviders: [{ capability: 'docs.latest', plugin: 'third-party.context7' }],
    })
  })

  it('resolves capabilities that follow the package open id pattern', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.github-workflow',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.github-workflow', {
          pluginDependencies: ['third-party.github-mcp'],
          requiredCapabilities: {
            'ci.status': { required: true, provider: 'third-party.github-mcp' },
          },
          optionalCapabilities: ['deploy.preview'],
        }),
        providerPlugin('third-party.github-mcp', 'ci.status'),
      ]),
    })

    expect(result.ok).toBe(true)
    expect(result.requiredCapabilities).toEqual([
      expect.objectContaining({
        capability: 'ci.status',
        requestedProvider: 'third-party.github-mcp',
      }),
    ])
    expect(result.optionalCapabilities).toEqual([
      expect.objectContaining({
        capability: 'deploy.preview',
      }),
    ])
    expect(result.chosenProviders).toEqual([
      expect.objectContaining({
        capability: 'ci.status',
        plugin: 'third-party.github-mcp',
      }),
    ])
  })

  it('hard-fails when a required capability has no installable provider', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.saas',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.saas', {
          requiredCapabilities: {
            'plan.ledger': { required: true },
          },
        }),
      ]),
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'required_provider_missing',
        capability: 'plan.ledger',
      }),
    ])
  })

  it('warns when an optional capability has no provider', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.webapp',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.webapp', {
          optionalCapabilities: ['browser.verify'],
        }),
      ]),
    })

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'optional_provider_missing',
        capability: 'browser.verify',
      }),
    ])
  })

  it('uses the plan ledger fallback when PlanDB is unavailable', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.base',
      now: NOW,
      loader: memoryLoader([
        basePlugin('instructa.base', {
          requiredCapabilities: {
            'plan.ledger': {
              required: true,
              provider: 'third-party.plandb',
              fallback: 'docs/plan-ledger/events.jsonl',
            },
          },
        }),
      ]),
    })

    expect(result.ok).toBe(true)
    expect(result.requiredCapabilities).toEqual([
      expect.objectContaining({
        capability: 'plan.ledger',
        requestedProvider: 'third-party.plandb',
        fallback: 'docs/plan-ledger/events.jsonl',
      }),
    ])
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'capability_fallback_used',
        capability: 'plan.ledger',
        provider: 'third-party.plandb',
      }),
    ])
  })

  it('rejects listed providers for required capabilities', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.saas',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.saas', {
          pluginDependencies: ['third-party.context7'],
          requiredCapabilities: {
            'docs.latest': { required: true, provider: 'third-party.context7' },
          },
        }),
        providerPlugin('third-party.context7', 'docs.latest', { trustTier: 'listed' }),
      ]),
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'listed_required_provider',
      capability: 'docs.latest',
      provider: 'third-party.context7',
    }))
  })

  it.each(['blocked', 'yanked'] as const)('hard-fails on %s providers', async (trustTier) => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.saas',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.saas', {
          pluginDependencies: ['third-party.context7'],
          requiredCapabilities: {
            'docs.latest': { required: true, provider: 'third-party.context7' },
          },
        }),
        providerPlugin('third-party.context7', 'docs.latest', {
          trustTier,
          installability: trustTier,
        }),
      ]),
    })

    expect(result.ok).toBe(false)
    expect(result.blockedYankedProviders).toEqual([
      expect.objectContaining({
        capability: 'docs.latest',
        provider: 'third-party.context7',
        trustTier,
        installability: trustTier,
      }),
    ])
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'blocked_or_yanked_provider',
      provider: 'third-party.context7',
    }))
  })

  it('warns about stale providers outside their verification cadence', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.saas',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.saas', {
          pluginDependencies: ['third-party.context7'],
          requiredCapabilities: {
            'docs.latest': { required: true, provider: 'third-party.context7' },
          },
        }),
        providerPlugin('third-party.context7', 'docs.latest', {
          lastVerified: '2026-04-01',
          cadence: '30d',
        }),
      ]),
    })

    expect(result.ok).toBe(true)
    expect(result.staleProviders).toEqual([
      expect.objectContaining({
        capability: 'docs.latest',
        provider: 'third-party.context7',
        lastVerified: '2026-04-01',
        cadence: '30d',
      }),
    ])
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'stale_provider',
      capability: 'docs.latest',
      provider: 'third-party.context7',
    }))
  })

  it('reports conflict when project plugins require the same capability with different providers', async () => {
    const result = await resolveCapabilityGraph({
      pluginRef: 'instructa.combo',
      now: NOW,
      loader: memoryLoader([
        projectPlugin('instructa.combo', {
          pluginDependencies: ['instructa.website', 'instructa.webapp'],
        }),
        projectPlugin('instructa.website', {
          requiredCapabilities: {
            'docs.latest': { required: true, provider: 'third-party.context7' },
          },
        }),
        projectPlugin('instructa.webapp', {
          requiredCapabilities: {
            'docs.latest': { required: true, provider: 'third-party.docs-alt' },
          },
        }),
        providerPlugin('third-party.context7', 'docs.latest'),
        providerPlugin('third-party.docs-alt', 'docs.latest'),
      ]),
    })

    expect(result.ok).toBe(false)
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        capability: 'docs.latest',
        providers: ['third-party.context7', 'third-party.docs-alt'],
      }),
    ])
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'conflicting_required_provider',
      capability: 'docs.latest',
    }))
  })
})

function memoryLoader(records: readonly CapabilityPluginRecord[]): CapabilityPluginLoader {
  const byName = new Map(records.map((record) => [record.manifest.name, record]))
  return {
    async loadPlugin(ref) {
      return byName.get(parseCapabilityPluginRef(ref).name) ?? null
    },
    async findCapabilityProviders(capability) {
      return records.filter((record) => Boolean(agentRigPluginExtension(record.manifest)?.providesCapabilities?.[capability]))
    },
  }
}

function basePlugin(
  name: string,
  extension: Partial<AgentRigPluginExtension> = {}
): CapabilityPluginRecord {
  return pluginRecord(name, {
    profile: 'base',
    pluginDependencies: [],
    ...extension,
  })
}

function projectPlugin(
  name: string,
  extension: AgentRigPluginExtension
): CapabilityPluginRecord {
  return pluginRecord(name, {
    profile: 'project',
    pluginDependencies: [],
    ...extension,
  })
}

function providerPlugin(
  name: string,
  capability: string,
  options: {
    trustTier?: CapabilityPluginRecord['trustTier']
    installability?: CapabilityPluginRecord['installability']
    lastVerified?: string
    cadence?: string
    providerTargets?: AgentRigPluginExtension['providerTargets']
    installConstraints?: CapabilityPluginRecord['installConstraints']
  } = {}
): CapabilityPluginRecord {
  return pluginRecord(
    name,
    {
      profile: 'third-party',
      providesCapabilities: {
        [capability]: {
          type: capability === 'plan.ledger' ? 'ledger' : 'tool',
          requiredByCore: false,
        },
      },
      providerTargets: options.providerTargets ?? ['codex', 'claude-code', 'cursor'],
      verification: {
        lastVerified: options.lastVerified ?? '2026-06-01',
        cadence: options.cadence ?? '30d',
        smokeTest: `verify/${name}-smoke.md`,
      },
    },
    options
  )
}

function pluginRecord(
  name: string,
  extension: AgentRigPluginExtension,
  options: {
    trustTier?: CapabilityPluginRecord['trustTier']
    installability?: CapabilityPluginRecord['installability']
    installConstraints?: CapabilityPluginRecord['installConstraints']
  } = {}
): CapabilityPluginRecord {
  return {
    ref: name,
    manifest: {
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name,
      version: '1.0.0',
      description: `${name} fixture`,
      extensions: {
        'ai.agentrig': {
          kind: 'plugin',
          ...extension,
        },
      },
    },
    trustTier: options.trustTier ?? 'reviewed',
    installability: options.installability ?? 'installable',
    installConstraints: options.installConstraints,
  }
}
