import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
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
import { resolvePluginFromRegistryAlias } from '../../src/lib/registry'
import { startFixtureServer, type FixtureServer } from '../helpers/harness'
import type { InstallBundle } from '@agentrig/sdk'

const servers: FixtureServer[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('install bundle resolution and materialization', () => {
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
          pathname: '/api/cli/plugins/install-bundle',
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
      'community-typescript',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph
    const materialized = await materializeResolvedPluginGraph(graph)

    try {
      await expect(
        fs.readFile(path.join(materialized.pluginDir, 'skills', 'typescript', 'SKILL.md'), 'utf-8')
      ).resolves.toBe(skill)
      expect(server.requests[0]?.pathname).toBe('/api/cli/plugins/install-bundle')
      expect(server.requests[0]?.search).toContain('listingId=community-typescript')
    } finally {
      await cleanupMaterializedPlugin(materialized.pluginsRoot)
    }
  })

  it('surfaces yanked and taken-down install responses as hard errors', async () => {
    const server = await startFixtureServer({
      routes: [{
        pathname: '/api/cli/plugins/install-bundle',
        handler: (request) => {
          const listingId = new URLSearchParams(request.search).get('listingId')
          return {
            status: 410,
            body: listingId === 'community-typescript-yanked'
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
      'community-typescript-yanked',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )).rejects.toThrow(/yanked.*Publisher withdrew/i)

    await expect(resolvePluginFromRegistryAlias(
      'agentrig',
      'community-typescript-taken-down',
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
          pathname: '/api/cli/plugins/install-bundle',
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
      'community-typescript',
      undefined,
      [{ name: 'agentrig', url: server.baseUrl }]
    )
    const graph = { requestedPlugin: resolved, resolvedPlugins: [resolved] } satisfies ResolvedPluginGraph
    const writeFile = vi.spyOn(fs, 'writeFile')

    await expect(materializeResolvedPluginGraph(graph))
      .rejects.toThrow(/skills\/typescript\/SKILL\.md: missing/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('aborts before writing when fetched install files include an unlisted extra file', async () => {
    const pluginJson = JSON.stringify({ kind: 'agentrig:plugin', id: 'community.typescript', name: 'TypeScript skill', description: '', version: '0.1.0', configSchema: {} })
    const skill = '# TypeScript skill\n'
    const server = await startFixtureServer({
      routes: [{
        pathname: '/api/cli/plugins/install-bundle',
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
      'community-typescript',
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

function bundle(baseUrl: string, pluginJson: string, skill: string): InstallBundle {
  return {
    schemaVersion: 1,
    listing: {
      listingId: 'listing-1',
      kind: 'plugin',
      origin: 'standalone',
      artifactId: 'community.typescript',
      name: 'TypeScript skill',
      description: 'TypeScript patterns.',
      version: '0.1.0',
      source: 'registry',
      slug: 'community-typescript',
      registryAlias: 'agentrig',
      registrySnapshotDigest: `sha256:${sha256Hex(`${pluginJson}\0${skill}`)}`,
      installability: 'available',
      publishedAt: Date.parse('2026-04-25T00:00:00.000Z'),
      updatedAt: Date.parse('2026-04-25T00:00:00.000Z'),
    },
    source: { type: 'registry', url: `${baseUrl}/raw/` },
    file_list: [
      { path: '.plugin/plugin.json', sha256: sha256Hex(pluginJson), size: Buffer.byteLength(pluginJson) },
      { path: 'skills/typescript/SKILL.md', sha256: sha256Hex(skill), size: Buffer.byteLength(skill) },
    ],
  }
}

function sha256Hex(input: string) {
  return createHash('sha256').update(Buffer.from(input)).digest('hex')
}
