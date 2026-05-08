import { describe, expect, it } from 'vitest'
import {
  InstallBundleSchema,
  MarketplaceListingSchema,
  isResolvable,
  verifyInstallBundleHashes,
  type InstallBundle,
  type MarketplaceListing,
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

  it('only resolves currently available listings', () => {
    expect(isResolvable(listing)).toBe(true)
    expect(isResolvable({ ...listing, installability: 'yanked' })).toBe(false)
    expect(isResolvable({ ...listing, installability: 'taken_down' })).toBe(false)
  })
})

describe('verifyInstallBundleHashes', () => {
  it('verifies every listed file by size and sha256', async () => {
    await expect(verifyInstallBundleHashes(bundle, [{ path: 'README.md', bytes: 'hello' }]))
      .resolves.toEqual({ ok: true, checked: 1, issues: [] })
  })

  it('reports missing, size, and hash mismatches', async () => {
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
      [{ path: 'README.md', bytes: 'hello!' }]
    )

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'size_mismatch',
      'sha256_mismatch',
      'missing',
    ])
  })
})
