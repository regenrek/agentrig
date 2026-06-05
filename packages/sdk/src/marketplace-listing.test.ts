import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  buildRegistryMirrorArtifactsFromInstallBundle,
  CAPABILITY_IDS,
  InstallBundleSchema,
  MarketplaceListingPublicSchema,
  MarketplaceListingSchema,
  PluginManifestSchema,
  agentRigInstallCommandFingerprint,
  isResolvable,
  resolvePluginSkillName,
  verifyInstallBundleHashes,
  type InstallBundle,
  type MarketplaceListing,
  type MarketplaceListingPublic,
} from './marketplace-listing'

const listing: MarketplaceListing = MarketplaceListingSchema.parse({
  kind: 'plugin',
  origin: 'standalone',
  artifactId: 'acme.demo',
  name: 'Demo plugin',
  description: 'A demo plugin.',
  version: '1.0.0',
  license: 'MIT',
  category: 'Development',
  source: 'registry',
  installability: 'available',
  publishedAt: 1,
  updatedAt: 1,
})

const bundle: InstallBundle = InstallBundleSchema.parse({
  schemaVersion: 1,
  listing,
  source: {
    type: 'github',
    url: 'https://github.com/acme/demo',
    commitSha: 'a'.repeat(40),
  },
  file_list: [
    {
      path: 'README.md',
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      size: 5,
    },
  ],
})

describe('marketplace listing contracts', () => {
  it('keeps internal Convex ids out of the public listing type', () => {
    expectTypeOf<MarketplaceListingPublic>().not.toHaveProperty('listingId')
    expectTypeOf<MarketplaceListingPublic>().not.toHaveProperty('submissionId')
    expectTypeOf<MarketplaceListingPublic>().not.toHaveProperty('ownerUserId')
    expectTypeOf<MarketplaceListingPublic>().not.toHaveProperty('parentArtifactListingId')

    expect(
      MarketplaceListingPublicSchema.parse({
        ...listing,
        listingId: 'listing-1',
        submissionId: 'submission-1',
        ownerUserId: 'user-1',
        parentArtifactListingId: 'listing-parent',
      })
    ).not.toMatchObject({
      listingId: expect.anything(),
      submissionId: expect.anything(),
      ownerUserId: expect.anything(),
      parentArtifactListingId: expect.anything(),
    })
  })

  it('requires installability on listings', () => {
    expect(() =>
      MarketplaceListingSchema.parse({
        ...listing,
        installability: undefined,
      })
    ).toThrow()
  })

  it('requires categories on plugin listings', () => {
    const { category: _category, ...uncategorizedListing } = listing

    expect(() => MarketplaceListingSchema.parse(uncategorizedListing)).toThrow(/category/i)
    expect(() =>
      InstallBundleSchema.parse({
        ...bundle,
        listing: uncategorizedListing,
      })
    ).toThrow(/category/i)
  })

  it('requires sha256 and size on install bundle files', () => {
    expect(() =>
      InstallBundleSchema.parse({
        ...bundle,
        file_list: [{ path: 'README.md' }],
      })
    ).toThrow()
  })

  it('accepts a canonical README storage reference on install bundles', () => {
    expect(
      InstallBundleSchema.parse({
        ...bundle,
        readmeFile: {
          path: 'README.md',
          sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
          size: 5,
          storageId: 'storage-readme-1',
        },
      }).readmeFile
    ).toEqual({
      path: 'README.md',
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      size: 5,
      storageId: 'storage-readme-1',
    })
  })

  it('normalizes README bundle metadata to the canonical path only', () => {
    expect(() =>
      InstallBundleSchema.parse({
        ...bundle,
        readmeFile: {
          path: 'readme.mdx',
          sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
          size: 5,
          storageId: 'storage-readme-1',
        },
      })
    ).toThrow()
  })

  it('only resolves currently available listings', () => {
    expect(isResolvable(listing)).toBe(true)
    expect(isResolvable({ ...listing, installability: 'yanked' })).toBe(false)
    expect(isResolvable({ ...listing, installability: 'taken_down' })).toBe(false)
  })

  it('parses the Open Plugins manifest shape with only name required', () => {
    const manifest = PluginManifestSchema.parse({
      $schema: 'https://agentrig.ai/schema/plugin.v1.json',
      name: 'agentrig.core',
      author: { email: 'plugins@example.com' },
      homepage: 'https://example.com/agentrig.core',
      commands: { review: './commands/review.md' },
      'x-agentrig': {
        displayName: 'Core',
        listing: {
          category: 'Development',
        },
      },
    })

    expect(manifest).toMatchObject({
      name: 'agentrig.core',
      author: { email: 'plugins@example.com' },
      homepage: 'https://example.com/agentrig.core',
      'x-agentrig': {
        displayName: 'Core',
        listing: {
          category: 'Development',
        },
      },
    })
    expect(manifest.version).toBeUndefined()
    expect(manifest.description).toBeUndefined()
    expect((manifest as Record<string, unknown>).commands).toEqual({ review: './commands/review.md' })
  })

  it('accepts a project plugin with final capability requirements', () => {
    const manifest = PluginManifestSchema.parse({
      $schema: 'https://agentrig.ai/schema/plugin.v1.json',
      name: 'instructa.saas',
      version: '1.0.0',
      description: 'Agentic engineering workflow plugin for SaaS products.',
      author: { name: 'Instructa', url: 'https://instructa.ai' },
      license: 'MIT',
      keywords: ['instructa', 'saas', 'agentic-engineering'],
      'x-agentrig': {
        kind: 'plugin',
        profile: 'project',
        pluginDependencies: [
          'agentrig/instructa.base@^1.0.0',
          'agentrig/instructa.core@^1.0.0',
          'agentrig/third-party.context7@^1.0.0',
        ],
        requiredCapabilities: {
          'plan.ledger': {
            required: true,
            provider: 'third-party.plandb',
            fallback: 'docs/plan-ledger/events.jsonl',
          },
          'docs.latest': {
            required: true,
            provider: 'third-party.context7',
          },
          'browser.verify': {
            required: true,
            provider: 'third-party.playwright-mcp',
          },
        },
        optionalCapabilities: ['repo.remote', 'deploy.preview', 'observability.logs'],
        providerTargets: ['codex', 'claude-code', 'cursor'],
      },
    })

    expect(manifest['x-agentrig']).toMatchObject({
      kind: 'plugin',
      profile: 'project',
      pluginDependencies: [
        'agentrig/instructa.base@^1.0.0',
        'agentrig/instructa.core@^1.0.0',
        'agentrig/third-party.context7@^1.0.0',
      ],
      requiredCapabilities: {
        'plan.ledger': {
          required: true,
          provider: 'third-party.plandb',
          fallback: 'docs/plan-ledger/events.jsonl',
        },
        'docs.latest': {
          required: true,
          provider: 'third-party.context7',
        },
        'browser.verify': {
          required: true,
          provider: 'third-party.playwright-mcp',
        },
      },
      optionalCapabilities: ['repo.remote', 'deploy.preview', 'observability.logs'],
      providerTargets: ['codex', 'claude-code', 'cursor'],
    })
  })

  it('accepts a third-party provider with final capability metadata', () => {
    const manifest = PluginManifestSchema.parse({
      $schema: 'https://agentrig.ai/schema/plugin.v1.json',
      name: 'third-party.plandb',
      version: '1.0.0',
      description: 'Curated provider manifest for the plan.ledger capability.',
      author: { name: 'Instructa', url: 'https://instructa.ai' },
      license: 'MIT',
      keywords: ['third-party', 'ledger', 'plandb'],
      'x-agentrig': {
        kind: 'plugin',
        profile: 'third-party',
        owner: 'external',
        supportLevel: 'curated',
        providesCapabilities: {
          'plan.ledger': {
            type: 'ledger',
            requiredByCore: false,
            riskLevel: 'medium',
            fallback: 'docs/plan-ledger/events.jsonl',
          },
          'ci.status': {
            type: 'tool',
            requiredByCore: false,
            riskLevel: 'medium',
          },
        },
        providerTargets: ['codex', 'claude-code', 'cursor'],
        verification: {
          lastVerified: '2026-06-04',
          cadence: '30d',
          smokeTest: 'verify/plandb-smoke.md',
        },
        security: {
          requiresConsent: true,
          showsExactCommands: true,
          requiresEnvVars: [],
          notes: 'Provider manifest only. Does not own PlanDB upstream code.',
        },
        replacementPolicy: {
          capabilities: ['plan.ledger', 'ci.status'],
          replaceWithoutCourseChange: true,
        },
        risk: {
          level: 'medium',
        },
      },
    })

    expect(manifest['x-agentrig']).toMatchObject({
      profile: 'third-party',
      owner: 'external',
      supportLevel: 'curated',
      providesCapabilities: {
        'plan.ledger': {
          type: 'ledger',
          requiredByCore: false,
          riskLevel: 'medium',
        },
      },
      providerTargets: ['codex', 'claude-code', 'cursor'],
      verification: {
        lastVerified: '2026-06-04',
      },
      security: {
        requiresConsent: true,
        showsExactCommands: true,
        requiresEnvVars: [],
      },
      replacementPolicy: {
        capabilities: ['plan.ledger', 'ci.status'],
        replaceWithoutCourseChange: true,
      },
      risk: {
        level: 'medium',
      },
    })
  })

  it('resolves existing skill aliases to canonical manifest skill names', () => {
    const manifest = PluginManifestSchema.parse({
      name: 'instructa.core',
      version: '1.0.0',
      description: 'Lean reusable anti-drift engineering skills for agentic coding.',
      'x-agentrig': {
        kind: 'plugin',
        profile: 'core',
        publicSkills: [
          'project-spec-packager',
          'duplicate-ownership-audit',
          'test-ownership',
        ],
        supportSkills: ['ship-gate'],
        aliases: {
          'app-spec-packager': 'project-spec-packager',
          'find-duplicate-ownership': 'duplicate-ownership-audit',
          'consolidate-test-suites': 'test-ownership',
        },
      },
    })

    expect(resolvePluginSkillName(manifest, 'find-duplicate-ownership')).toEqual({
      plugin: 'instructa.core',
      requestedName: 'find-duplicate-ownership',
      canonicalName: 'duplicate-ownership-audit',
      matched: 'alias',
    })
    expect(resolvePluginSkillName(manifest, 'duplicate-ownership-audit')).toEqual({
      plugin: 'instructa.core',
      requestedName: 'duplicate-ownership-audit',
      canonicalName: 'duplicate-ownership-audit',
      matched: 'canonical',
    })
  })

  it('accepts the verified install command fingerprint field', async () => {
    const commandFingerprint = await agentRigInstallCommandFingerprint([{
      mcpServers: {
        context7: {
          command: 'node',
          args: ['server.js'],
          env: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}' },
        },
      },
    }])

    const manifest = PluginManifestSchema.parse({
      name: 'third-party.context7',
      version: '1.0.0',
      description: 'Context7 provider fixture.',
      mcpServers: {
        context7: {
          command: 'node',
          args: ['server.js'],
        },
      },
      'x-agentrig': {
        kind: 'plugin',
        profile: 'third-party',
        verification: {
          lastVerified: '2026-06-04',
          cadence: '30d',
          smokeTest: 'verify/context7-smoke.md',
          commandFingerprint,
        },
      },
    })

    expect(manifest['x-agentrig']?.verification?.commandFingerprint).toBe(commandFingerprint)
  })

  it('keeps final x-agentrig metadata optional', () => {
    expect(PluginManifestSchema.parse({ name: 'agentrig.minimal' })).toEqual({ name: 'agentrig.minimal' })
    expect(
      PluginManifestSchema.parse({
        name: 'agentrig.minimal-metadata',
        'x-agentrig': {
          displayName: 'Minimal metadata',
          kind: 'plugin',
          pluginDependencies: [],
        },
      })['x-agentrig']
    ).toMatchObject({
      displayName: 'Minimal metadata',
      kind: 'plugin',
      pluginDependencies: [],
    })
  })

  it('documents known AgentRig 1.0 capability id examples without closing validation', () => {
    expect(CAPABILITY_IDS).toEqual([
      'plan.ledger',
      'docs.latest',
      'browser.verify',
      'repo.remote',
      'ci.status',
      'repo.security',
      'deploy.preview',
      'observability.logs',
      'mcp.verify',
      'secrets.scan',
      'supplychain.scan',
      'shell.lint',
      'desktop.runtime',
      'native.debug',
    ])

    expect(
      PluginManifestSchema.parse({
        name: 'third-party.custom-provider',
        'x-agentrig': {
          kind: 'plugin',
          providesCapabilities: {
            'custom.tool-chain': {
              type: 'tool',
              requiredByCore: false,
            },
          },
          replacementPolicy: {
            capabilities: ['custom.tool-chain'],
            replaceWithoutCourseChange: true,
          },
        },
      })['x-agentrig']?.providesCapabilities
    ).toHaveProperty('custom.tool-chain')
  })

  it('validates Open Plugins name and version syntax', () => {
    expect(() => PluginManifestSchema.parse({ name: 'agentrig--core' })).toThrow()
    expect(() => PluginManifestSchema.parse({ name: 'agentrig.core', version: 'latest' })).toThrow()
  })

  it('rejects invalid AgentRig manifest metadata values', () => {
    expect(() =>
      PluginManifestSchema.parse({
        name: 'instructa.saas',
        'x-agentrig': { kind: 'plugin', profile: 'stack' },
      })
    ).toThrow()
    expect(() =>
      PluginManifestSchema.parse({
        name: 'instructa.saas',
        'x-agentrig': {
          kind: 'plugin',
          requiredCapabilities: {
            'Not.canonical': { required: true },
          },
        },
      })
    ).toThrow()
    expect(() =>
      PluginManifestSchema.parse({
        name: 'third-party.context7',
        'x-agentrig': {
          kind: 'plugin',
          providesCapabilities: {
            'docs.latest': {
              type: 'documentation',
              requiredByCore: false,
            },
          },
        },
      })
    ).toThrow()
    expect(() =>
      PluginManifestSchema.parse({
        name: 'third-party.context7',
        'x-agentrig': {
          kind: 'plugin',
          verification: {
            lastVerified: 'June 4, 2026',
            cadence: '30d',
            smokeTest: 'verify/context7-smoke.md',
          },
        },
      })
    ).toThrow()
  })

  it('emits the required registry LICENSE file from listing license metadata', async () => {
    const artifacts = await buildRegistryMirrorArtifactsFromInstallBundle({
      bundle,
      files: [{ path: 'README.md', bytes: 'hello' }],
      submissionId: 'submission-1',
      reviewedAt: 1,
      advisoriesDocument: { generated_at: '1970-01-01T00:00:00Z', items: [] },
      registryDocument: { items: [] } as any,
    })

    const licenseFile = artifacts.generatedFiles.find((file) => file.path.endsWith('/LICENSE'))
    const lockFile = artifacts.generatedFiles.find((file) => file.path.endsWith('/AGENTRIG_LOCK.json'))

    expect(licenseFile).toMatchObject({ content: 'MIT\n' })
    expect(JSON.parse(lockFile!.content).file_digests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'LICENSE',
          digest: 'sha256:adc37366f403835c1470ab2df93d3837d4719372fc1ef8593d922e06f033f8b2',
          size: 4,
        }),
      ])
    )
  })
})

describe('verifyInstallBundleHashes', () => {
  it('verifies every listed file by size and sha256', async () => {
    await expect(verifyInstallBundleHashes(bundle, [{ path: 'README.md', bytes: 'hello' }]))
      .resolves.toEqual({ ok: true, checked: 1, issues: [] })
  })

  it('reports expected files omitted by the fetcher as not_written', async () => {
    const result = await verifyInstallBundleHashes(
      {
        ...bundle,
        file_list: [
          ...bundle.file_list,
          {
            path: 'missing.txt',
            sha256: 'a'.repeat(64),
            size: 1,
          },
        ],
      },
      [{ path: 'README.md', bytes: 'hello' }]
    )

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(['not_written'])
  })

  it('reports HTTP fetch failures as not_fetched', async () => {
    const result = await verifyInstallBundleHashes(bundle, [
      {
        path: 'README.md',
        missing: true,
        error: 'Request failed (404)',
        status: 404,
        url: 'https://example.test/README.md',
        bodySnippet: 'Not found',
      },
    ])

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      {
        path: 'README.md',
        code: 'not_fetched',
        error: 'Request failed (404)',
        status: 404,
        url: 'https://example.test/README.md',
        bodySnippet: 'Not found',
      },
    ])
  })

  it('reports sha256 mismatches', async () => {
    const result = await verifyInstallBundleHashes(bundle, [{ path: 'README.md', bytes: 'jello' }])

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(['hash_mismatch'])
  })

  it('reports size mismatches', async () => {
    const result = await verifyInstallBundleHashes(
      {
        ...bundle,
        file_list: [
          {
            ...bundle.file_list[0]!,
            sha256: 'ce06092fb948d9ffac7d1a376e404b26b7575bcc11ee05a4615fef4fec3a308b',
            size: 5,
          },
        ],
      },
      [{ path: 'README.md', bytes: 'hello!' }]
    )

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(['size_mismatch'])
  })

  it('reports fetched files that are not listed in the bundle', async () => {
    const result = await verifyInstallBundleHashes(bundle, [
      { path: 'README.md', bytes: 'hello' },
      { path: 'extras/secret.txt', bytes: 'extra' },
    ])

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(['extra'])
  })

  it('reports missing and extra files together', async () => {
    const result = await verifyInstallBundleHashes(
      {
        ...bundle,
        file_list: [
          ...bundle.file_list,
          {
            path: 'missing.txt',
            sha256: 'a'.repeat(64),
            size: 1,
          },
        ],
      },
      [
        { path: 'README.md', bytes: 'hello' },
        { path: 'extras/secret.txt', bytes: 'extra' },
      ]
    )

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(['not_written', 'extra'])
  })
})
