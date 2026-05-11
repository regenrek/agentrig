import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  InstallBundleSchema,
  MarketplaceListingPublicSchema,
  MarketplaceListingSchema,
  PluginManifestSchema,
  isResolvable,
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
      },
    })

    expect(manifest).toMatchObject({
      name: 'agentrig.core',
      author: { email: 'plugins@example.com' },
      homepage: 'https://example.com/agentrig.core',
      'x-agentrig': { displayName: 'Core' },
    })
    expect(manifest.version).toBeUndefined()
    expect(manifest.description).toBeUndefined()
    expect((manifest as Record<string, unknown>).commands).toEqual({ review: './commands/review.md' })
  })

  it('validates Open Plugins name and version syntax', () => {
    expect(() => PluginManifestSchema.parse({ name: 'agentrig--core' })).toThrow()
    expect(() => PluginManifestSchema.parse({ name: 'agentrig.core', version: 'latest' })).toThrow()
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
