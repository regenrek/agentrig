import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  verifyFetchedInstallBundleFiles,
  type ResolvedPluginGraph,
} from '../../src/lib/plugin-consumer'
import { canonicalInstallTokenFromSlug, resolvePluginFromRegistryAlias } from '../../src/lib/registry'
import { startFixtureServer, type FixtureServer } from '../helpers/harness'
import type { InstallBundle } from '@agentrig/sdk'

const servers: FixtureServer[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('install bundle resolution and materialization', () => {
  it('converts hyphenated marketplace slugs to canonical install tokens without flattening child separators', () => {
    expect(canonicalInstallTokenFromSlug('regenrek-agent-skills')).toBe('regenrek.agent-skills')
    expect(canonicalInstallTokenFromSlug('regenrek-agent-skills--skill-pr-commiter')).toBe(
      'regenrek.agent-skills--skill-pr-commiter'
    )
    expect(canonicalInstallTokenFromSlug('regenrek.agent-skills')).toBe('regenrek.agent-skills')
  })

  it('resolves a marketplace listing slug to an InstallBundle and materializes verified files', async () => {
    const pluginJson = JSON.stringify({
      kind: 'agentrig:plugin',
      id: 'community.typescript',
      name: 'TypeScript skill',
      description: 'TypeScript patterns.',
      version: '0.1.0',
      configSchema: {},
    })
    const skill = '# TypeScript skill\n'
    const server = await startFixtureServer({
      routes: [
        {
          pathname: '/api/cli/install-bundle',
          handler: (request) => ({
            body: {
              status: 'resolvable',
              listing: bundle(server.baseUrl, pluginJson, skill).listing,
              bundle: bundle(server.baseUrl, pluginJson, skill),
            },
          }),
        },
        { pathname: '/raw/.plugin/plugin.json', handler: () => ({ body: pluginJson }) },
        { pathname: '/raw/skills/typescript/SKILL.md', handler: () => ({ body: skill }) },
      ],
    })
    servers.push(server)

    const resolved = await resolvePluginFromRegistryAlias(
      'agentrig',
      'community.typescript',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph
    const materialized = await materializeResolvedPluginGraph(graph)

    try {
      await expect(
        fs.readFile(path.join(materialized.pluginDir, 'skills', 'typescript', 'SKILL.md'), 'utf-8')
      ).resolves.toBe(skill)
      expect(server.requests[0]?.pathname).toBe('/api/cli/install-bundle')
      expect(server.requests[0]?.search).toContain('kind=plugin')
      expect(server.requests[0]?.search).toContain('artifactId=community.typescript')
    } finally {
      await cleanupMaterializedPlugin(materialized.pluginsRoot)
    }
  })

  it('retries install resolution with the canonical dotted token after a hyphenated not_found', async () => {
    const pluginJson = JSON.stringify({
      kind: 'agentrig:plugin',
      id: 'regenrek.agent-skills',
      name: 'Agent skills',
      description: 'Agent skills.',
      version: '0.1.0',
      configSchema: {},
    })
    const skill = '# Agent skills\n'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const server = await startFixtureServer({
      routes: [
        {
          pathname: '/api/cli/install-bundle',
          handler: (request) => {
            const artifactId = new URLSearchParams(request.search).get('artifactId')
            if (artifactId === 'regenrek-agent-skills') {
              return {
                status: 404,
                body: {
                  status: 'unresolvable',
                  reason: 'not_found',
                  message: 'No plugin listing found for regenrek-agent-skills.',
                },
              }
            }
            return {
              body: {
                status: 'resolvable',
                listing: bundle(server.baseUrl, pluginJson, skill, {
                  artifactId: 'regenrek.agent-skills',
                  slug: 'regenrek-agent-skills',
                }).listing,
                bundle: bundle(server.baseUrl, pluginJson, skill, {
                  artifactId: 'regenrek.agent-skills',
                  slug: 'regenrek-agent-skills',
                }),
              },
            }
          },
        },
        { pathname: '/raw/.plugin/plugin.json', handler: () => ({ body: pluginJson }) },
        { pathname: '/raw/skills/typescript/SKILL.md', handler: () => ({ body: skill }) },
      ],
    })
    servers.push(server)

    const resolved = await resolvePluginFromRegistryAlias(
      'agentrig',
      'regenrek-agent-skills',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )

    expect(resolved.listing.artifactId).toBe('regenrek.agent-skills')
    expect(server.requests.filter((request) => request.pathname === '/api/cli/install-bundle')).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalledWith(
      'Resolved by hyphen→dot fallback; canonical id is `regenrek.agent-skills`. Update your scripts.'
    )
    warnSpy.mockRestore()
  })

  it('surfaces yanked and taken-down install responses as hard errors', async () => {
    const server = await startFixtureServer({
      routes: [{
        pathname: '/api/cli/install-bundle',
        handler: (request) => {
          const artifactId = new URLSearchParams(request.search).get('artifactId')
          return {
            status: 410,
            body: artifactId === 'community.typescript-yanked'
              ? {
                  status: 'unresolvable',
                  reason: 'yanked',
                  message: 'Publisher withdrew this listing.',
                }
              : {
                  status: 'unresolvable',
                  reason: 'taken_down',
                  message: 'Policy violation.',
                },
          }
        },
      }],
    })
    servers.push(server)

    await expect(resolvePluginFromRegistryAlias(
      'agentrig',
      'community.typescript-yanked',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )).rejects.toThrow(/yanked.*Publisher withdrew/i)

    await expect(resolvePluginFromRegistryAlias(
      'agentrig',
      'community.typescript-taken-down',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )).rejects.toThrow(/taken down.*Policy violation/i)
  })

  it('aborts materialization on sha256 mismatches', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const expected = '# TypeScript skill\n'
    const server = await installBundleServer(pluginJson, 'tampered\n', expected)
    const graph = { requestedPlugin: bundle(server.baseUrl, pluginJson, expected), resolvedPlugins: [bundle(server.baseUrl, pluginJson, expected)] }
    const writeFile = vi.spyOn(fs, 'writeFile')

    await expect(materializeResolvedPluginGraph(graph)).rejects.toThrow(/sha256_mismatch/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('reports missing remote files through install bundle verification before writing files', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const skill = '# TypeScript skill\n'
    const server = await startFixtureServer({
      routes: [
        {
          pathname: '/api/cli/install-bundle',
          handler: () => ({
            body: {
              status: 'resolvable',
              listing: bundle(server.baseUrl, pluginJson, skill).listing,
              bundle: bundle(server.baseUrl, pluginJson, skill),
            },
          }),
        },
        { pathname: '/raw/.plugin/plugin.json', handler: () => ({ body: pluginJson }) },
      ],
    })
    servers.push(server)
    const resolved = await resolvePluginFromRegistryAlias(
      'agentrig',
      'community.typescript',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph
    const writeFile = vi.spyOn(fs, 'writeFile')

    await expect(materializeResolvedPluginGraph(graph))
      .rejects.toThrow(/Failed to fetch skills\/typescript\/SKILL\.md: HTTP 404/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('reports GitHub raw rate limits as fetch failures instead of bundle corruption', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const skill = '# TypeScript skill\n'
    const current = bundle('https://raw.githubusercontent.com/acme/repo/main', pluginJson, skill)

    await expect(verifyFetchedInstallBundleFiles(current, [
      { path: '.plugin/plugin.json', bytes: pluginJson },
      {
        path: 'skills/typescript/SKILL.md',
        missing: true,
        error: 'Request failed (429) for https://raw.githubusercontent.com/acme/repo/main/skills/typescript/SKILL.md',
        status: 429,
        url: 'https://raw.githubusercontent.com/acme/repo/main/skills/typescript/SKILL.md',
      },
    ])).rejects.toThrow(/Failed to fetch skills\/typescript\/SKILL\.md: HTTP 429 \(rate-limited by github\.com\).*GITHUB_TOKEN/)
  })

  it('aborts before writing when fetched install files include an unlisted extra file', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const skill = '# TypeScript skill\n'
    const server = await startFixtureServer({
      routes: [{
        pathname: '/api/cli/install-bundle',
        handler: () => ({
          body: {
            status: 'resolvable',
            listing: bundle(server.baseUrl, pluginJson, skill).listing,
            bundle: bundle(server.baseUrl, pluginJson, skill),
          },
        }),
      }],
    })
    servers.push(server)
    const resolved = await resolvePluginFromRegistryAlias(
      'agentrig',
      'community.typescript',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph
    const writeFile = vi.spyOn(fs, 'writeFile')

    await expect(materializeResolvedPluginGraph(graph, {
      fetchInstallBundleFiles: async () => [
        { path: '.plugin/plugin.json', bytes: pluginJson },
        { path: 'skills/typescript/SKILL.md', bytes: skill },
        { path: 'extras/secret.txt', bytes: 'extra' },
      ],
    })).rejects.toThrow(/extras\/secret\.txt: extra/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('reports extra fetched files through CLI verification formatting', async () => {
    const pluginJson = '{}'
    const current = bundle('https://example.test', pluginJson, '# Skill\n')

    await expect(verifyFetchedInstallBundleFiles(current, [
      { path: '.plugin/plugin.json', bytes: pluginJson },
      { path: 'skills/typescript/SKILL.md', bytes: '# Skill\n' },
      { path: 'extra.txt', bytes: 'extra' },
    ])).rejects.toThrow(/extra.txt: extra/)
  })

  it('materializes mixed URL-backed and inline-base64 install bundle files, preferring inline over url', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const inlineSkill = '# Inline skill\n'
    const urlSkill = '# URL skill\n'
    const server = await startFixtureServer({
      routes: [
        { pathname: '/raw/.plugin/plugin.json', handler: () => ({ body: pluginJson }) },
        { pathname: '/inline-url/skills/typescript/SKILL.md', handler: () => ({ body: urlSkill }) },
      ],
    })
    servers.push(server)
    const resolved = bundle(server.baseUrl, pluginJson, inlineSkill, {
      skillFile: {
        url: `${server.baseUrl}/inline-url/skills/typescript/SKILL.md`,
        inline: Buffer.from(inlineSkill).toString('base64'),
      },
    })
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph
    const materialized = await materializeResolvedPluginGraph(graph)

    try {
      await expect(
        fs.readFile(path.join(materialized.pluginDir, '.plugin', 'plugin.json'), 'utf-8')
      ).resolves.toBe(pluginJson)
      await expect(
        fs.readFile(path.join(materialized.pluginDir, 'skills', 'typescript', 'SKILL.md'), 'utf-8')
      ).resolves.toBe(inlineSkill)
      expect(server.requests.some((request) => request.pathname === '/inline-url/skills/typescript/SKILL.md')).toBe(false)
    } finally {
      await cleanupMaterializedPlugin(materialized.pluginsRoot)
    }
  })

  it('fails loudly when an install bundle file has neither inline bytes nor a readable url/source', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const skill = '# TypeScript skill\n'
    const resolved = {
      ...bundle('https://example.test', pluginJson, skill),
      source: { type: 'convex_storage' as const },
    }
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph

    await expect(materializeResolvedPluginGraph(graph))
      .rejects.toThrow(/skills\/typescript\/SKILL\.md: missing/)
  })
})

async function installBundleServer(pluginJson: string, fetchedSkill: string, expectedSkill: string) {
  const server = await startFixtureServer({
    routes: [
      { pathname: '/raw/.plugin/plugin.json', handler: () => ({ body: pluginJson }) },
      { pathname: '/raw/skills/typescript/SKILL.md', handler: () => ({ body: fetchedSkill }) },
    ],
  })
  servers.push(server)
  return server
}

function bundle(
  baseUrl: string,
  pluginJson: string,
  skill: string,
  options: { artifactId?: string; slug?: string; skillFile?: { url?: string; inline?: string } } = {}
): InstallBundle {
  const artifactId = options.artifactId ?? 'community.typescript'
  return {
    schemaVersion: 1,
    listing: {
      kind: 'plugin',
      origin: 'standalone',
      artifactId,
      name: 'TypeScript skill',
      description: 'TypeScript patterns.',
      version: '0.1.0',
      source: 'registry',
      slug: options.slug ?? 'community-typescript',
      registryAlias: 'agentrig',
      registrySnapshotDigest: `sha256:${sha256Hex(`${pluginJson}\0${skill}`)}`,
      installability: 'available',
      publishedAt: Date.parse('2026-04-25T00:00:00.000Z'),
      updatedAt: Date.parse('2026-04-25T00:00:00.000Z'),
    },
    source: { type: 'registry', url: `${baseUrl}/raw/` },
    file_list: [
      { path: '.plugin/plugin.json', sha256: sha256Hex(pluginJson), size: Buffer.byteLength(pluginJson) },
      {
        path: 'skills/typescript/SKILL.md',
        sha256: sha256Hex(skill),
        size: Buffer.byteLength(skill),
        ...(options.skillFile?.url ? { url: options.skillFile.url } : {}),
        ...(options.skillFile?.inline ? { inline: options.skillFile.inline } : {}),
      },
    ],
  }
}

function sha256Hex(input: string) {
  return createHash('sha256').update(Buffer.from(input)).digest('hex')
}
