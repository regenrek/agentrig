import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import command, { __doctorGeneratedFileChecksForTests, runDoctor, type DoctorCheck } from '../../src/commands/doctor'
import { exportPluginProviders, type ProviderExportResult } from '../../src/lib/plugin-providers'
import { savePluginInstallLedger } from '../../src/lib/plugin-install-ledger'
import { startFixtureServer, type FixtureServer } from '../helpers/harness'
import { agentRigInstallCommandFingerprint, type InstallBundle, type PluginManifest } from '@agentrig/sdk'
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
    expect(output).toContain('✓ Codex generated files verified')
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

  it('hard-fails when a required provider install command changed since verification', async () => {
    const fixture = await createDoctorFixture({
      context7: {
        commandFingerprint: `sha256:${'0'.repeat(64)}`,
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
        id: 'provider-install-command-fingerprint',
        status: 'fail',
        message: 'third-party.context7: install command changed since last verification',
      }),
    ]))
  })

  it('hard-fails when GitHub permissions default toolsets request all', async () => {
    const fixture = await createDoctorFixture({
      github: {
        permissionsDefaultToolsets: ['context', 'all'],
      },
    })
    await installLedgerRecords(fixture.cwd, [
      'instructa.saas',
      'instructa.base',
      'third-party.context7',
      'third-party.github-mcp',
    ])

    const result = await runDoctor({
      spec: 'agentrig/instructa.saas',
      provider: 'codex',
      cwd: fixture.cwd,
    })

    expect(result.exitCode).toBe(1)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mcp-github-toolsets',
        status: 'fail',
        message: 'third-party.github-mcp',
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

  it('verifies Claude Code and Cursor generated files', async () => {
    const fixture = await createDoctorFixture()

    const claude = await runDoctor({
      spec: 'agentrig/instructa.saas',
      provider: 'claude-code',
      cwd: fixture.cwd,
    })
    const cursor = await runDoctor({
      spec: 'agentrig/instructa.saas',
      provider: 'cursor',
      cwd: fixture.cwd,
    })

    expect(checkById(claude.checks, 'claude-generated-files')).toEqual(expect.objectContaining({
      status: 'pass',
      label: 'Claude Code generated files verified',
    }))
    expect(checkById(cursor.checks, 'cursor-generated-files')).toEqual(expect.objectContaining({
      status: 'pass',
      label: 'Cursor generated files verified',
    }))
  })

  it('fails Claude generated-file checks when .mcp.json omits Claude variables', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-doctor-generated-test-'))
    tempDirs.push(root)
    const cwd = path.join(root, 'workspace')
    const pluginsRoot = path.join(root, 'plugins')
    const out = path.join(root, 'out')
    await fs.mkdir(cwd, { recursive: true })
    await writeProviderPluginSource(pluginsRoot)

    const [result] = await exportPluginProviders({
      cwd,
      agent: 'claude',
      pluginsDir: pluginsRoot,
      out,
    })
    const providerName = 'agentrig-third-party-context7'
    await fs.writeFile(
      path.join(out, 'plugins', providerName, '.mcp.json'),
      JSON.stringify({ mcpServers: { context7: { command: 'node', args: ['server.js'] } } }, null, 2),
      'utf-8'
    )

    const checks = await collectGeneratedChecks('claude-code', 'claude', result)

    expect(checkById(checks, 'claude-generated-files')).toEqual(expect.objectContaining({
      status: 'fail',
      message: expect.stringContaining(`${providerName}:.mcp.json Claude path variables`),
    }))
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
    includeSkillFile?: boolean
    includeMcpFile?: boolean
    commandFingerprint?: string
  }
  github?: {
    permissionsDefaultToolsets?: string[]
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
      ...(options.github ? ['agentrig/third-party.github-mcp@^1.0.0'] : []),
    ],
    requiredCapabilities: {
      'docs.latest': {
        required: true,
        provider: 'third-party.context7',
      },
      ...(options.github
        ? {
            'repo.remote': {
              required: true,
              provider: 'third-party.github-mcp',
            },
          }
        : {}),
    },
  })
  const base = pluginManifest('instructa.base', {
    profile: 'base',
  })
  const includeContext7Skill = options.context7?.includeSkillFile ?? true
  const includeContext7Mcp = options.context7?.includeMcpFile ?? true
  const context7McpConfig = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      context7: {
        type: 'stdio',
        command: 'node',
        args: ['./scripts/server.mjs'],
        cwd: '${PLUGIN_ROOT}',
      },
    },
  }
  const context7CommandFingerprint = options.context7?.commandFingerprint
    ?? await agentRigInstallCommandFingerprint([
      ...(includeContext7Mcp ? [context7McpConfig] : []),
    ])
  const context7 = {
    ...pluginManifest('third-party.context7', {
      profile: 'third-party',
      providesCapabilities: {
        'docs.latest': {
          type: 'tool',
          requiredByCore: false,
        },
      },
      security: {
        requiresConsent: true,
        showsExactCommands: true,
        requiresEnvVars: options.context7?.requiredEnvVars ?? [],
        notes: 'Provider manifest fixture for doctor tests.',
      },
    }),
  } satisfies PluginManifest
  const github = options.github
    ? pluginManifest('third-party.github-mcp', {
        profile: 'third-party',
        providesCapabilities: {
          'repo.remote': {
            type: 'tool',
            requiredByCore: false,
          },
        },
        security: {
          requiresConsent: true,
          showsExactCommands: true,
          requiresEnvVars: [],
          notes: 'Provider manifest fixture for doctor tests.',
        },
        permissions: {
          defaultToolsets: options.github.permissionsDefaultToolsets ?? [],
        },
      })
    : undefined
  const context7Files: Record<string, string> = {
    'verify/context7-smoke.md': '# Context7 smoke\n',
    ...(includeContext7Mcp
      ? {
          'mcp.json': JSON.stringify(context7McpConfig, null, 2),
          'scripts/server.mjs': 'process.stdin.resume()\n',
        }
      : {}),
    ...(includeContext7Skill
      ? { 'skills/context7-docs/SKILL.md': [
          '---',
          'name: context7-docs',
          'description: Fetch current library documentation through Context7 MCP.',
          '---',
          '',
          '# Context7 Docs',
        ].join('\n') }
      : {}),
  }

  const bundleInputs: Array<{
    artifactId: string
    manifest: PluginManifest
    files: Record<string, string>
    trustTier: 'official' | 'reviewed' | 'listed' | 'blocked' | 'yanked'
    installability: 'installable' | 'discovery_only' | 'blocked' | 'yanked'
    controlPlane?: InstallBundle['controlPlane']
  }> = [
    {
      artifactId: 'instructa.saas',
      manifest: project,
      files: {},
      trustTier: 'official',
      installability: 'installable',
    },
    {
      artifactId: 'instructa.base',
      manifest: base,
      files: {},
      trustTier: 'official',
      installability: 'installable',
    },
    {
      artifactId: 'third-party.context7',
      manifest: context7,
      files: context7Files,
      trustTier: options.context7?.trustTier ?? 'reviewed',
      installability: options.context7?.installability ?? 'installable',
      controlPlane: {
        providerCompatibility: { codex: 'native', 'claude-code': 'native', cursor: 'native' },
        verification: {
          lastVerified: options.context7?.lastVerified ?? '2026-08-01',
          cadence: '30d',
          smokeTest: 'verify/context7-smoke.md',
          ...(context7CommandFingerprint ? { commandFingerprint: context7CommandFingerprint } : {}),
        },
      },
    },
  ]
  if (github) {
    bundleInputs.push({
      artifactId: 'third-party.github-mcp',
      manifest: github,
      files: { 'verify/github-smoke.md': '# GitHub smoke\n' },
      trustTier: 'reviewed',
      installability: 'installable',
      controlPlane: {
        providerCompatibility: { codex: 'native', 'claude-code': 'native', cursor: 'native' },
        verification: {
          lastVerified: '2026-06-01',
          cadence: '30d',
          smokeTest: 'verify/github-smoke.md',
        },
      },
    })
  }

  for (const { artifactId, manifest, files, trustTier, installability, controlPlane } of bundleInputs) {
    bundles.set(
      artifactId,
      installBundle(server.baseUrl, manifest, files, trustTier, installability, controlPlane)
    )
  }

  return { cwd, home, server }
}

function pluginManifest(name: string, extension: Record<string, unknown>): PluginManifest {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name,
    version: '1.0.0',
    description: `${name} fixture`,
    author: { name: 'AgentRig Test' },
    license: 'MIT',
    keywords: ['test'],
    extensions: {
      'ai.agentrig': {
        ...extension,
      },
    },
  }
}

function installBundle(
  baseUrl: string,
  manifest: PluginManifest,
  files: Record<string, string>,
  trustTier: 'official' | 'reviewed' | 'listed' | 'blocked' | 'yanked',
  installability: 'installable' | 'discovery_only' | 'blocked' | 'yanked',
  controlPlane?: InstallBundle['controlPlane']
): InstallBundle {
  const manifestJson = JSON.stringify(manifest, null, 2)
  const fileEntries = {
    'plugin.json': manifestJson,
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
    controlPlane,
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

async function writeProviderPluginSource(pluginsRoot: string) {
  const pluginDir = path.join(pluginsRoot, 'third-party.context7')
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.mkdir(path.join(pluginDir, 'skills', 'context7-docs'), { recursive: true })
  await fs.writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'third-party.context7',
      version: '1.0.0',
      description: 'Context7 provider fixture.',
      extensions: {
        'ai.agentrig': {
          displayName: 'Context7',
        },
      },
    }, null, 2),
    'utf-8'
  )
  await fs.writeFile(
    path.join(pluginDir, 'skills', 'context7-docs', 'SKILL.md'),
    [
      '---',
      'name: context7-docs',
      'description: Fetch current library documentation through Context7 MCP.',
      '---',
      '',
      '# Context7 Docs',
    ].join('\n'),
    'utf-8'
  )
  await fs.writeFile(
    path.join(pluginDir, 'mcp.json'),
    JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        context7: {
          type: 'stdio',
          command: 'node',
          args: ['./scripts/server.mjs'],
          cwd: '${PLUGIN_ROOT}',
        },
      },
    }, null, 2),
    'utf-8'
  )
  await fs.mkdir(path.join(pluginDir, 'scripts'), { recursive: true })
  await fs.writeFile(path.join(pluginDir, 'scripts', 'server.mjs'), 'process.stdin.resume()\n', 'utf-8')
}

async function collectGeneratedChecks(
  provider: 'codex' | 'claude-code' | 'cursor',
  installProvider: 'codex' | 'claude' | 'cursor',
  result: ProviderExportResult | undefined
) {
  if (!result) throw new Error('Missing provider export result.')
  const checks: DoctorCheck[] = []
  await __doctorGeneratedFileChecksForTests.addGeneratedFileChecksForProvider(
    provider,
    installProvider,
    result,
    (check) => checks.push(check)
  )
  return checks
}

function checkById(checks: DoctorCheck[], id: string) {
  const check = checks.find((item) => item.id === id)
  if (!check) {
    const generated = checks.find((item) => item.id === 'provider-generated-files')
    throw new Error(`Missing doctor check: ${id}; provider-generated-files: ${JSON.stringify(generated)}; available checks: ${checks.map((item) => item.id).join(', ')}`)
  }
  return check
}

function sha256Hex(input: string) {
  return createHash('sha256').update(Buffer.from(input)).digest('hex')
}
