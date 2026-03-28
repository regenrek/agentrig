import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { sha256Hex } from '../../src/lib/hash'
import {
  cleanupE2EWorkspace,
  createE2EWorkspace,
  readJsonFile,
  runBuiltCli,
  validateVpProject,
  writeJsonFile,
  writeTextFile,
  type E2EWorkspace,
} from '../helpers/e2e'
import { startFixtureServer, type FixtureServer } from '../helpers/harness'

type RegistryFileSpec = {
  path: string
  target: string
  contents: string
  mode?: string
  sha256?: string | false
}

type RegistryPackSpec = {
  name: string
  title: string
  description: string
  version?: string
  tags?: string[]
  rigDependencies?: string[]
  files: RegistryFileSpec[]
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeRegistryPack(registryRoot: string, spec: RegistryPackSpec) {
  const files = []
  for (const file of spec.files) {
    const absolutePath = path.join(registryRoot, file.path)
    const bytes = Buffer.from(file.contents)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, bytes)
    files.push({
      path: file.path,
      target: file.target,
      ...(file.mode ? { mode: file.mode } : {}),
      ...(file.sha256 === false
        ? {}
        : { sha256: file.sha256 ?? sha256Hex(bytes) }),
    })
  }

  await writeJsonFile(path.join(registryRoot, `${spec.name}.json`), {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    version: spec.version ?? '1.0.0',
    tags: spec.tags,
    rigDependencies: spec.rigDependencies,
    files,
  })

  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    version: spec.version ?? '1.0.0',
    meta: `${spec.name}.json`,
  }
}

async function writeRegistryIndex(
  registryRoot: string,
  name: string,
  items: Array<{
    name: string
    title: string
    description: string
    version: string
    meta: string
  }>
) {
  await writeJsonFile(path.join(registryRoot, 'registry.json'), {
    name,
    items,
  })
}

async function createRegistryFixtures(workspace: E2EWorkspace) {
  const staticRoot = path.join(workspace.rootDir, 'fixture-server')
  const listedRoot = path.join(staticRoot, 'listed-registry')
  const officialRoot = path.join(staticRoot, 'official-registry')
  const unlistedRoot = path.join(staticRoot, 'unlisted-registry')

  const listedItems = await Promise.all([
    writeRegistryPack(listedRoot, {
      name: 'listed-pack',
      title: 'Listed Pack',
      description: 'Pack served from a listed registry.',
      files: [
        {
          path: 'packs/listed-pack/skills/listed/SKILL.md',
          target: '.codex/skills/listed/SKILL.md',
          contents: '# listed\n',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'core-pack',
      title: 'Core Pack',
      description: 'Base rig pack.',
      files: [
        {
          path: 'packs/core-pack/skills/shared/SKILL.md',
          target: '.codex/skills/shared/SKILL.md',
          contents: '# core\n',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'overlay-pack',
      title: 'Overlay Pack',
      description: 'Conflicting rig pack that should install after base.',
      files: [
        {
          path: 'packs/overlay-pack/skills/shared/SKILL.md',
          target: '.codex/skills/shared/SKILL.md',
          contents: '# overlay\n',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'extra-pack',
      title: 'Extra Pack',
      description: 'Additional rig pack.',
      files: [
        {
          path: 'packs/extra-pack/skills/extra/SKILL.md',
          target: '.codex/skills/extra/SKILL.md',
          contents: '# extra\n',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'prune-pack',
      title: 'Prune Pack',
      description: 'Pack used to verify rig pruning.',
      files: [
        {
          path: 'packs/prune-pack/skills/prune/SKILL.md',
          target: '.codex/skills/prune/SKILL.md',
          contents: '# prune\n',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'bad-hash-pack',
      title: 'Bad Hash Pack',
      description: 'Pack with an invalid integrity hash.',
      files: [
        {
          path: 'packs/bad-hash-pack/skills/hash/SKILL.md',
          target: '.codex/skills/hash/SKILL.md',
          contents: '# hash\n',
          sha256: 'deadbeef',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'unsafe-target-pack',
      title: 'Unsafe Target Pack',
      description: 'Pack with a target path outside the allowlist.',
      files: [
        {
          path: 'packs/unsafe-target-pack/skills/unsafe/SKILL.md',
          target: '../outside/SKILL.md',
          contents: '# unsafe\n',
        },
      ],
    }),
    writeRegistryPack(listedRoot, {
      name: 'cross-origin-pack',
      title: 'Cross Origin Pack',
      description: 'Pack that tries to fetch an external file.',
      files: [
        {
          path: 'https://example.com/steal.txt',
          target: '.codex/skills/cross-origin/SKILL.md',
          contents: '# never-fetched\n',
          sha256: false,
        },
      ],
    }),
  ])

  await writeJsonFile(path.join(listedRoot, 'malformed-pack.json'), {
    name: 'malformed-pack',
    description: 'Missing title on purpose.',
    version: '1.0.0',
    files: [],
  })
  listedItems.push({
    name: 'malformed-pack',
    title: 'Malformed Pack',
    description: 'Broken metadata fixture.',
    version: '1.0.0',
    meta: 'malformed-pack.json',
  })

  await writeRegistryIndex(listedRoot, 'listed-registry', listedItems)

  const officialItems = await Promise.all([
    writeRegistryPack(officialRoot, {
      name: 'official-pack',
      title: 'Official Pack',
      description: 'Pack served from the official registry.',
      files: [
        {
          path: 'packs/official-pack/skills/official/SKILL.md',
          target: '.codex/skills/official/SKILL.md',
          contents: '# official\n',
        },
      ],
    }),
  ])
  await writeRegistryIndex(officialRoot, 'official-registry', officialItems)

  const unlistedItems = await Promise.all([
    writeRegistryPack(unlistedRoot, {
      name: 'unlisted-pack',
      title: 'Unlisted Pack',
      description: 'Pack served from an unlisted registry.',
      files: [
        {
          path: 'packs/unlisted-pack/skills/unlisted/SKILL.md',
          target: '.codex/skills/unlisted/SKILL.md',
          contents: '# unlisted\n',
        },
      ],
    }),
  ])
  await writeRegistryIndex(unlistedRoot, 'unlisted-registry', unlistedItems)
}

function buildTrustEnv(server: FixtureServer) {
  return {
    AGENTRIG_DIRECTORY_INDEX_URL: server.url('/directory/index.json'),
    AGENTRIG_OFFICIAL_REGISTRY_URL: server.url('/official-registry'),
  }
}

function listedRegistryUrl(server: FixtureServer) {
  return server.url('/listed-registry')
}

function officialRegistryUrl(server: FixtureServer) {
  return server.url('/official-registry')
}

function unlistedRegistryUrl(server: FixtureServer) {
  return server.url('/unlisted-registry')
}

describe.sequential('e2e:registry-rig-security', () => {
  let workspace: E2EWorkspace | null = null
  let server: FixtureServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    await cleanupE2EWorkspace(workspace)
    workspace = null
  })

  it('lists, views, installs, and safely removes listed registry packs', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    await createRegistryFixtures(workspace)
    server = await startFixtureServer({
      staticRoot: path.join(workspace.rootDir, 'fixture-server'),
      routes: [
        {
          pathname: '/directory/index.json',
          handler: () => ({
            body: [
              {
                name: '@listed',
                url: `${server?.baseUrl ?? 'http://127.0.0.1'}/listed-registry/{name}.json`,
                verified: true,
              },
            ],
          }),
        },
      ],
    })

    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    const env = buildTrustEnv(server)

    await runBuiltCli(['init', '--registry', officialRegistryUrl(server)], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })

    await runBuiltCli(['registry', 'add', 'listed', listedRegistryUrl(server)], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })

    const registryList = await runBuiltCli(['registry', 'list'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(registryList.stdout).toContain(`official: ${officialRegistryUrl(server)}`)
    expect(registryList.stdout).toContain(`listed: ${listedRegistryUrl(server)}`)

    const available = await runBuiltCli(['list', '--available', '--registry', 'listed'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(available.stdout).toContain('listed-pack@1.0.0  Listed Pack')

    const viewed = await runBuiltCli(['view', 'listed/listed-pack', '--json'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    const viewedJson = JSON.parse(viewed.stdout) as {
      trustTier: string
      source: string
      files: Array<{ target: string }>
    }
    expect(viewedJson.trustTier).toBe('listed')
    expect(viewedJson.source).toBe('registry:listed')
    expect(viewedJson.files[0]?.target).toBe('.codex/skills/listed/SKILL.md')

    await runBuiltCli(['add', 'listed/listed-pack'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })

    const installedPath = path.join(project.dir, '.codex', 'skills', 'listed', 'SKILL.md')
    expect(await pathExists(installedPath)).toBe(true)

    const installedList = await runBuiltCli(['list'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(installedList.stdout).toContain('listed-pack@1.0.0 (registry:listed)')

    await fs.appendFile(installedPath, 'manual edit\n', 'utf-8')
    const removed = await runBuiltCli(['remove', 'listed-pack'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(removed.stdout).toContain('Kept (changed since install):')
    expect(removed.stdout).toContain('.codex/skills/listed/SKILL.md')
    expect(await pathExists(installedPath)).toBe(true)

    const manifest = await readJsonFile<{ installed: Record<string, unknown> }>(
      path.join(project.dir, '.agentrig', 'manifest.json')
    )
    expect(Object.keys(manifest.installed)).toHaveLength(0)
  })

  it('applies rigs with extends, prune, and idempotent re-apply behavior', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    await createRegistryFixtures(workspace)
    server = await startFixtureServer({
      staticRoot: path.join(workspace.rootDir, 'fixture-server'),
      routes: [
        {
          pathname: '/directory/index.json',
          handler: () => ({
            body: [
              {
                name: '@listed',
                url: `${server?.baseUrl ?? 'http://127.0.0.1'}/listed-registry/{name}.json`,
                verified: true,
              },
            ],
          }),
        },
      ],
    })

    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    const env = buildTrustEnv(server)

    await writeJsonFile(path.join(project.dir, 'agentrig.config.json'), {
      $schema: 'https://agentrig.ai/schema/config.json',
      skillsDir: '.codex/skills',
      registries: [{ name: 'official', url: listedRegistryUrl(server) }],
      defaultRig: 'layered',
      rigs: {
        base: { packs: ['core-pack'] },
        layered: { extends: ['base'], packs: ['overlay-pack', 'extra-pack', 'core-pack'] },
        pruneOnly: { packs: ['prune-pack'] },
      },
    })

    const listedRigs = await runBuiltCli(['rig', 'list'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(listedRigs.stdout).toContain('  - layered (default)')
    expect(listedRigs.stdout).toContain('extends: base | packs: overlay-pack, extra-pack, core-pack')

    const firstApply = await runBuiltCli(['rig', 'apply'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(firstApply.stdout).toContain('packs: core-pack, overlay-pack, extra-pack')
    expect(
      await fs.readFile(path.join(project.dir, '.codex', 'skills', 'shared', 'SKILL.md'), 'utf-8')
    ).toBe('# core\n')
    expect(await pathExists(path.join(project.dir, '.codex', 'skills', 'extra', 'SKILL.md'))).toBe(true)

    const secondApply = await runBuiltCli(['rig', 'apply'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(secondApply.stdout).toContain('skipped:')

    const manifestAfterReapply = await readJsonFile<{
      installed: Record<string, { files: Array<{ target: string }> }>
    }>(path.join(project.dir, '.agentrig', 'manifest.json'))
    expect(
      manifestAfterReapply.installed['core-pack']?.files.map((file) => file.target)
    ).toContain('.codex/skills/shared/SKILL.md')
    expect(
      manifestAfterReapply.installed['extra-pack']?.files.map((file) => file.target)
    ).toContain('.codex/skills/extra/SKILL.md')

    const prunedApply = await runBuiltCli(['rig', 'apply', 'pruneOnly'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(prunedApply.stdout).toContain('Pruning 3 pack(s): core-pack, overlay-pack, extra-pack')
    expect(await pathExists(path.join(project.dir, '.codex', 'skills', 'prune', 'SKILL.md'))).toBe(true)
    expect(await pathExists(path.join(project.dir, '.codex', 'skills', 'extra', 'SKILL.md'))).toBe(false)
  })

  it('classifies official, listed, and unlisted registries and enforces confirmation', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    await createRegistryFixtures(workspace)
    server = await startFixtureServer({
      staticRoot: path.join(workspace.rootDir, 'fixture-server'),
      routes: [
        {
          pathname: '/directory/index.json',
          handler: () => ({
            body: [
              {
                name: '@listed',
                url: `${server?.baseUrl ?? 'http://127.0.0.1'}/listed-registry/{name}.json`,
                verified: true,
              },
            ],
          }),
        },
      ],
    })

    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    const env = buildTrustEnv(server)

    await writeJsonFile(path.join(project.dir, 'agentrig.config.json'), {
      $schema: 'https://agentrig.ai/schema/config.json',
      skillsDir: '.codex/skills',
      registries: [
        { name: 'official', url: officialRegistryUrl(server) },
        { name: 'listed', url: listedRegistryUrl(server) },
      ],
    })

    const officialView = await runBuiltCli(['view', 'official-pack', '--json'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(JSON.parse(officialView.stdout).trustTier).toBe('official')

    const listedView = await runBuiltCli(['view', 'listed/listed-pack', '--json'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(JSON.parse(listedView.stdout).trustTier).toBe('listed')

    const unlistedView = await runBuiltCli(
      ['view', `${unlistedRegistryUrl(server)}/unlisted-pack.json`, '--json'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      }
    )
    expect(JSON.parse(unlistedView.stdout).trustTier).toBe('unlisted')

    await expect(
      runBuiltCli(['add', `${unlistedRegistryUrl(server)}/unlisted-pack.json`], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      })
    ).rejects.toThrow('This pack is from an unlisted source. Re-run with --yes to confirm install.')

    await runBuiltCli(['add', `${unlistedRegistryUrl(server)}/unlisted-pack.json`, '--yes'], {
      cwd: project.dir,
      homeDir: workspace.homeDir,
      env,
    })
    expect(
      await pathExists(path.join(project.dir, '.codex', 'skills', 'unlisted', 'SKILL.md'))
    ).toBe(true)
  })

  it('rejects malformed metadata, unsafe targets, bad hashes, and external file fetches', async () => {
    workspace = await createE2EWorkspace(['project-a'])
    await createRegistryFixtures(workspace)
    server = await startFixtureServer({
      staticRoot: path.join(workspace.rootDir, 'fixture-server'),
      routes: [
        {
          pathname: '/directory/index.json',
          handler: () => ({
            body: [
              {
                name: '@listed',
                url: `${server?.baseUrl ?? 'http://127.0.0.1'}/listed-registry/{name}.json`,
                verified: true,
              },
            ],
          }),
        },
      ],
    })

    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project fixture')
    await validateVpProject(project, workspace)

    const env = buildTrustEnv(server)

    await writeJsonFile(path.join(project.dir, 'agentrig.config.json'), {
      $schema: 'https://agentrig.ai/schema/config.json',
      skillsDir: '.codex/skills',
      registries: [{ name: 'listed', url: listedRegistryUrl(server) }],
    })

    const unsafeView = await runBuiltCli(
      ['view', 'listed/unsafe-target-pack', '--json'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      }
    )
    expect(JSON.parse(unsafeView.stdout).pathValidation.valid).toBe(false)

    await expect(
      runBuiltCli(['view', 'listed/malformed-pack'], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      })
    ).rejects.toThrow('Invalid pack meta: missing title')

    await expect(
      runBuiltCli(['add', 'listed/unsafe-target-pack'], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      })
    ).rejects.toThrow('contains disallowed target paths')

    await expect(
      runBuiltCli(['add', 'listed/bad-hash-pack'], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      })
    ).rejects.toThrow('Integrity check failed')

    await expect(
      runBuiltCli(['add', 'listed/cross-origin-pack'], {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env,
      })
    ).rejects.toThrow('External URLs are not allowed for pack files')
  })
})
