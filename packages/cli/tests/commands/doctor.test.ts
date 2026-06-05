import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import command, { runDoctor } from '../../src/commands/doctor'
import { savePluginInstallLedger } from '../../src/lib/plugin-install-ledger'
import { startFixtureServer, type FixtureServer } from '../helpers/harness'
import type { InstallBundle, PluginManifest } from '@agentrig/sdk'
import type { PluginInstallRecord } from '../../src/lib/types'

const tempDirs: string[] = []
const servers: FixtureServer[] = []
const run = command.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

describe('command:doctor', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = undefined
    delete process.env.CONTEXT7_API_KEY
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    process.exitCode = undefined
    delete process.env.AGENTRIG_HOME
    delete process.env.CONTEXT7_API_KEY
    await Promise.all(servers.splice(0).map((server) => server.close()))
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('passes for a resolved and installed Codex project plugin', async () => {
    const fixture = await createDoctorFixture()
    await installLedgerRecords(fixture.cwd, ['instructa.saas', 'instructa.base', 'third-party.context7'])

    await run({
      args: {
        spec: 'agentrig/instructa.saas',
        provider: 'codex',
        cwd: fixture.cwd,
        json: false,
        help: false,
      },
    })

    const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('registry reachable')
    expect(process.exitCode).toBe(0)
    expect(output).toContain('AgentRig Doctor - instructa.saas / codex')
    expect(output).toContain('✓ docs.latest -> third-party.context7@1.0.0')
    expect(output).toContain('✓ Ready for Instructa Saas workflow.')
  })

  it('hard-fails when a required provider is blocked', async () => {
    const fixture = await createDoctorFixture({
      context7: {
        trustTier: 'blocked',
        installability: 'blocked',
      },
    })
    await installLedgerRecords(fixture.cwd, ['instructa.saas', 'instructa.base', 'third-party.context7'])

    const result = await runDoctor({
      spec: 'agentrig/instructa.saas',
      provider: 'codex',
      cwd: fixture.cwd,
    })

    expect(result.exitCode).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'yanked-blocked-status',
        status: 'fail',
      }),
    ]))
  })

  it('warns, but exits zero, when provider verification is stale', async () => {
    const fixture = await createDoctorFixture({
      context7: {
        lastVerified: '2020-01-01',
      },
    })
    await installLedgerRecords(fixture.cwd, ['instructa.saas', 'instructa.base', 'third-party.context7'])

    const result = await runDoctor({
      spec: 'agentrig/instructa.saas',
      provider: 'codex',
      cwd: fixture.cwd,
    })

    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('warning')
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'stale-verification-date',
        status: 'warn',
      }),
    ]))
  })

  it('hard-fails when required provider env vars are missing', async () => {
    const fixture = await createDoctorFixture({
      context7: {
        requiredEnvVars: ['CONTEXT7_API_KEY'],
      },
    })
    await installLedgerRecords(fixture.cwd, ['instructa.saas', 'instructa.base', 'third-party.context7'])

    const result = await runDoctor({
      spec: 'agentrig/instructa.saas',
      provider: 'codex',
      cwd: fixture.cwd,
    })

    expect(result.exitCode).toBe(1)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'required-env-vars',
        status: 'fail',
        message: 'CONTEXT7_API_KEY',
      }),
    ]))
  })

  it('prints machine-readable JSON output', async () => {
    const fixture = await createDoctorFixture()
    await installLedgerRecords(fixture.cwd, ['instructa.saas', 'instructa.base', 'third-party.context7'])

    await run({
      args: {
        spec: 'agentrig/instructa.saas',
        provider: 'codex',
        cwd: fixture.cwd,
        json: true,
        help: false,
      },
    })

    expect(process.exitCode).toBe(0)
    const raw = String(vi.mocked(console.log).mock.calls.at(-1)?.[0] ?? '')
    const parsed = JSON.parse(raw) as Awaited<ReturnType<typeof runDoctor>>
    expect(parsed).toEqual(expect.objectContaining({
      schemaVersion: 1,
      ok: true,
      input: expect.objectContaining({
        spec: 'agentrig/instructa.saas',
        provider: 'codex',
      }),
      capabilityResolution: expect.objectContaining({
        schemaVersion: 1,
        chosenProviders: expect.any(Array),
      }),
      provider: expect.objectContaining({
        selected: 'codex',
        scope: 'personal',
      }),
      exitCode: 0,
    }))
  })
})

async function createDoctorFixture(options: {
  context7?: {
    trustTier?: 'official' | 'reviewed' | 'listed' | 'blocked' | 'yanked'
    installability?: 'installable' | 'discovery_only' | 'blocked' | 'yanked'
    lastVerified?: string
    requiredEnvVars?: string[]
  }
} = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-doctor-test-'))
  tempDirs.push(root)
  const cwd = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  await fs.mkdir(cwd, { recursive: true })
  await fs.mkdir(home, { recursive: true })
  process.env.AGENTRIG_HOME = home

  const bundles = new Map<string, InstallBundle>()
  const server = await startFixtureServer({
    routes: [{
      pathname: '/api/cli/install-bundle',
      handler: (request) => {
        const artifactId = new URLSearchParams(request.search).get('artifactId')
        const bundle = artifactId ? bundles.get(artifactId) : undefined
        if (!bundle) {
          return {
            status: 404,
            body: {
              status: 'unresolvable',
              reason: 'not_found',
              message: `Missing fixture bundle: ${artifactId}`,
            },
          }
        }
        return {
          body: {
            status: 'resolvable',
            listing: bundle.listing,
            bundle,
          },
        }
      },
    }],
  })
  servers.push(server)

  await fs.writeFile(
    path.join(cwd, 'agentrig.config.json'),
    JSON.stringify({ registries: [{ name: 'agentrig', url: server.baseUrl }] }, null, 2),
    'utf-8'
  )

  const project = pluginManifest('instructa.saas', {
    profile: 'project',
    pluginDependencies: [
      'agentrig/instructa.base@^1.0.0',
      'agentrig/third-party.context7@^1.0.0',
    ],
    requiredCapabilities: {
      'docs.latest': {
        required: true,
        provider: 'third-party.context7',
      },
    },
    courseCompatibility: {
      kit: 'instructa-agentic-engineer-kit',
      version: '1.0.0',
    },
  })
  const base = pluginManifest('instructa.base', {
    profile: 'base',
  })
  const context7 = pluginManifest('third-party.context7', {
    profile: 'third-party',
    providerTargets: ['codex', 'claude-code', 'cursor'],
    providesCapabilities: {
      'docs.latest': {
        type: 'tool',
        requiredByCore: false,
        riskLevel: 'medium',
      },
    },
    verification: {
      lastVerified: options.context7?.lastVerified ?? '2026-06-01',
      cadence: '30d',
      smokeTest: 'verify/context7-smoke.md',
    },
    security: {
      requiresConsent: true,
      showsExactCommands: true,
      requiresEnvVars: options.context7?.requiredEnvVars ?? [],
      notes: 'Provider manifest fixture for doctor tests.',
    },
    replacementPolicy: {
      capabilities: ['docs.latest'],
      replaceWithoutCourseChange: true,
    },
  })

  for (const [artifactId, manifest, files, trustTier, installability] of [
    ['instructa.saas', project, {}, 'official', 'installable'],
    ['instructa.base', base, {}, 'official', 'installable'],
    [
      'third-party.context7',
      context7,
      { 'verify/context7-smoke.md': '# Context7 smoke\n' },
      options.context7?.trustTier ?? 'reviewed',
      options.context7?.installability ?? 'installable',
    ],
  ] as const) {
    bundles.set(
      artifactId,
      installBundle(server.baseUrl, manifest, files, trustTier, installability)
    )
  }

  return { cwd, home, server }
}

function pluginManifest(name: string, extension: Record<string, unknown>): PluginManifest {
  return {
    $schema: 'https://agentrig.ai/schema/plugin.v1.json',
    name,
    version: '1.0.0',
    description: `${name} fixture`,
    author: { name: 'AgentRig Test' },
    license: 'MIT',
    keywords: ['test'],
    'x-agentrig': {
      kind: 'plugin',
      listing: { category: 'Development' },
      ...extension,
    },
  }
}

function installBundle(
  baseUrl: string,
  manifest: PluginManifest,
  files: Record<string, string>,
  trustTier: 'official' | 'reviewed' | 'listed' | 'blocked' | 'yanked',
  installability: 'installable' | 'discovery_only' | 'blocked' | 'yanked'
): InstallBundle {
  const manifestJson = JSON.stringify(manifest, null, 2)
  const fileEntries = {
    '.plugin/plugin.json': manifestJson,
    ...files,
  }
  const fileList = Object.entries(fileEntries).map(([filePath, content]) => ({
    path: filePath,
    sha256: sha256Hex(content),
    size: Buffer.byteLength(content),
    inline: Buffer.from(content).toString('base64'),
  }))

  return {
    schemaVersion: 1,
    listing: {
      kind: 'plugin',
      origin: 'standalone',
      artifactId: manifest.name,
      name: manifest.name,
      description: manifest.description ?? manifest.name,
      version: manifest.version ?? '1.0.0',
      author: manifest.author?.name,
      license: manifest.license,
      keywords: manifest.keywords,
      category: 'Development',
      source: 'registry',
      slug: manifest.name,
      registryAlias: 'agentrig',
      registryTrustTier: trustTier,
      registryInstallability: installability,
      registrySnapshotDigest: `sha256:${sha256Hex(JSON.stringify(fileList))}`,
      registrySourceRepository: 'https://github.com/agentrig/agentrig-registry',
      installability: 'available',
      publishedAt: Date.parse('2026-06-01T00:00:00.000Z'),
      updatedAt: Date.parse('2026-06-01T00:00:00.000Z'),
    },
    source: { type: 'registry', url: `${baseUrl}/raw/` },
    file_list: fileList,
  }
}

async function installLedgerRecords(cwd: string, pluginIds: string[]) {
  const installs: Record<string, PluginInstallRecord> = {}
  for (const pluginId of pluginIds) {
    const pluginPath = path.join(cwd, '.codex-installed', pluginId)
    const marketplacePath = path.join(cwd, '.codex-installed', `${pluginId}.marketplace.json`)
    await fs.mkdir(pluginPath, { recursive: true })
    await fs.writeFile(marketplacePath, '{}', 'utf-8')
    const id = `codex:personal:${pluginId}`
    installs[id] = {
      id,
      provider: 'codex',
      requestedScope: 'auto',
      specIdentity: {
        kind: 'registry',
        registryAlias: 'agentrig',
        registryUrl: 'https://registry.test',
        pluginId,
        version: '1.0.0',
      },
      registry: {
        registryAlias: 'agentrig',
        registryUrl: 'https://registry.test',
        sourceRepository: 'https://github.com/agentrig/agentrig-registry',
        contractVersion: '1',
        generatedAt: '2026-06-01T00:00:00.000Z',
        signature: {
          algorithm: 'install-bundle-file-list-sha256',
          keyId: 'agentrig-marketplace-listing',
          signedDigest: 'sha256:test',
        },
      },
      scope: 'personal',
      pluginId,
      pluginVersion: '1.0.0',
      snapshotDigest: 'sha256:test',
      pluginName: pluginId,
      targetPaths: [pluginPath, marketplacePath],
      installedAt: '2026-06-01T00:00:00.000Z',
      files: [],
      metadata: {
        pluginPath,
        marketplacePath,
        marketplaceName: 'agentrig-local',
        pluginRef: `${pluginId}@agentrig-local`,
        appServerInstalled: true,
        marketplaceEntry: {
          name: pluginId,
          source: { source: 'local', path: `./plugins/${pluginId}` },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Development',
        },
      },
    }
  }

  await savePluginInstallLedger(cwd, 'personal', {
    schemaVersion: 4,
    installs,
    selections: {},
  })
}

function sha256Hex(input: string) {
  return createHash('sha256').update(Buffer.from(input)).digest('hex')
}
