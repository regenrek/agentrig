import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  appendTextFile,
  cleanupE2EWorkspace,
  createE2EWorkspace,
  populateFullPackContents,
  readJsonFile,
  runBuiltCli,
  writeTextFile,
  type E2EProject,
  type E2EWorkspace,
  validateVpProject,
} from '../helpers/e2e'
import {
  createNodeBackedCommand,
  readJsonLinesFile,
  withPrependedBinPath,
} from '../helpers/harness'

const registryUrl = 'https://agentrig.ai/registry'
const packName = 'full-e2e-pack'
const packTitle = 'Full E2E Pack'
const packDescription = 'Fixture pack for Vite+ E2E tests.'
const pluginName = `agentrig-${packName}`

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function assertVpBuildWorks(project: E2EProject, workspace: E2EWorkspace) {
  await validateVpProject(project, workspace)
  expect(await pathExists(path.join(project.dir, 'dist', 'index.html'))).toBe(true)
}

async function initializeProject(project: E2EProject, workspace: E2EWorkspace) {
  await runBuiltCli(['init', '--registry', registryUrl], {
    cwd: project.dir,
    homeDir: workspace.homeDir,
  })
}

async function writeInstallablePackContents(packDir: string) {
  await fs.rm(path.join(packDir, '.gitignore'), { force: true })
  await fs.rm(path.join(packDir, 'README.md'), { force: true })
  await fs.rm(path.join(packDir, 'agents'), { recursive: true, force: true })
  await fs.rm(path.join(packDir, 'hooks'), { recursive: true, force: true })
  await fs.rm(path.join(packDir, 'scripts'), { recursive: true, force: true })

  await writeTextFile(
    path.join(packDir, 'skills', 'reviewer', 'SKILL.md'),
    [
      '---',
      'name: reviewer',
      'description: Review code changes for bugs and missing tests.',
      '---',
      '',
      'Review code carefully.',
      'Prioritize regressions, behavioral risks, and missing coverage.',
      '',
    ].join('\n')
  )
}

async function scaffoldPack(
  project: E2EProject,
  workspace: E2EWorkspace,
  options: { consumerSafe?: boolean } = {}
) {
  await initializeProject(project, workspace)

  await runBuiltCli(
    [
      'pack',
      'init',
      packName,
      '--dir',
      workspace.packsRoot,
      '--title',
      packTitle,
      '--description',
      packDescription,
      '--author',
      'AgentRig E2E',
      '--template',
      'local',
    ],
    {
      cwd: project.dir,
      homeDir: workspace.homeDir,
    }
  )

  const packDir = path.join(workspace.packsRoot, packName)
  if (options.consumerSafe) {
    await writeInstallablePackContents(packDir)
  } else {
    await populateFullPackContents(packDir)
  }

  const generatedMetaPath = path.join(packDir, 'meta.generated.json')

  await runBuiltCli(
    [
      'pack',
      'create',
      packDir,
      '--name',
      packName,
      '--title',
      packTitle,
      '--description',
      packDescription,
      '--version',
      '1.0.0',
      '--out',
      generatedMetaPath,
    ],
    {
      cwd: project.dir,
      homeDir: workspace.homeDir,
    }
  )

  return { packDir, generatedMetaPath }
}

async function createFakeClaudeEnv(workspace: E2EWorkspace) {
  const binDir = path.join(workspace.rootDir, 'bin')
  const logPath = path.join(workspace.rootDir, 'claude-calls.jsonl')
  const statePath = path.join(workspace.rootDir, 'claude-state.json')

  await createNodeBackedCommand(
    binDir,
    'claude',
    `
import { promises as fs } from 'node:fs'
import path from 'node:path'

const logPath = process.env.AGENTRIG_FAKE_CLAUDE_LOG
const statePath = process.env.AGENTRIG_FAKE_CLAUDE_STATE
const args = process.argv.slice(2)

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf-8'))
  } catch {
    return { installs: [] }
  }
}

async function writeState(state) {
  await ensureParent(statePath)
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\\n', 'utf-8')
}

async function appendLog(entry) {
  await ensureParent(logPath)
  await fs.appendFile(logPath, JSON.stringify(entry) + '\\n', 'utf-8')
}

const state = await readState()
await appendLog({ args })

if (args[0] !== 'plugin') {
  console.error('Unsupported command')
  process.exit(1)
}

if (args[1] === 'marketplace' && args[2] === 'add') {
  process.exit(0)
}

if (args[1] === 'marketplace' && args[2] === 'remove') {
  process.exit(0)
}

if (args[1] === 'install') {
  const pluginRef = args[2]
  if (!state.installs.includes(pluginRef)) {
    state.installs.push(pluginRef)
    await writeState(state)
  }
  process.exit(0)
}

if (args[1] === 'uninstall') {
  const pluginRef = args[2]
  if (!state.installs.includes(pluginRef)) {
    console.error('Plugin not installed')
    process.exit(1)
  }
  state.installs = state.installs.filter((entry) => entry !== pluginRef)
  await writeState(state)
  process.exit(0)
}

console.error('Unsupported plugin subcommand')
process.exit(1)
`
  )

  return {
    env: withPrependedBinPath(binDir, {
      AGENTRIG_FAKE_CLAUDE_LOG: logPath,
      AGENTRIG_FAKE_CLAUDE_STATE: statePath,
    }),
    logPath,
  }
}

describe.sequential('e2e:vite-plus-playground', () => {
  let workspace: E2EWorkspace | null = null

  afterEach(async () => {
    await cleanupE2EWorkspace(workspace)
    workspace = null
  })

  it('validates the Vite+ app, scaffolds a pack, and exports all provider layouts', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

    await assertVpBuildWorks(project, workspace)
    const { packDir } = await scaffoldPack(project, workspace)
    const generatedMetaPath = path.join(packDir, 'meta.generated.json')

    const config = await readJsonFile<{ registries: Array<{ url: string }> }>(
      path.join(project.dir, 'agentrig.config.json')
    )
    expect(config.registries[0]?.url).toBe(registryUrl)

    const generatedMeta = await readJsonFile<{ files: Array<{ path: string }> }>(generatedMetaPath)
    expect(generatedMeta.files.some((file) => file.path === 'skills/reviewer/SKILL.md')).toBe(true)
    expect(generatedMeta.files.some((file) => file.path === '.mcp.json')).toBe(true)

    const exportRoot = path.join(workspace.distRoot, 'plugins')
    await runBuiltCli(
      [
        'pack',
        'plugin',
        'export',
        '--agent',
        'all',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--out',
        exportRoot,
        '--clean',
      ],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    const claudeManifest = await readJsonFile<{
      name: string
      commands?: string[]
      agents?: string[]
    }>(path.join(exportRoot, 'claude', 'plugins', pluginName, '.claude-plugin', 'plugin.json'))
    expect(claudeManifest.name).toBe(pluginName)
    expect(claudeManifest.commands).toEqual(['./commands'])
    expect(claudeManifest.agents).toEqual(['./agents'])
    expect(
      await pathExists(path.join(exportRoot, 'claude', 'plugins', pluginName, '.mcp.json'))
    ).toBe(true)
    expect(
      await pathExists(path.join(exportRoot, 'claude', 'plugins', pluginName, 'settings.json'))
    ).toBe(true)
    expect(
      await pathExists(path.join(exportRoot, 'claude', 'plugins', pluginName, '.lsp.json'))
    ).toBe(true)

    const codexManifest = await readJsonFile<{
      skills?: string
      mcpServers?: string
      apps?: string
    }>(path.join(exportRoot, 'codex', 'plugins', pluginName, '.codex-plugin', 'plugin.json'))
    expect(codexManifest.skills).toBe('./skills/')
    expect(codexManifest.mcpServers).toBe('./.mcp.json')
    expect(codexManifest.apps).toBe('./.app.json')

    const codexMarketplace = await readJsonFile<{
      plugins: Array<{ source: { path: string } }>
    }>(path.join(exportRoot, 'codex', '.agents', 'plugins', 'marketplace.json'))
    expect(codexMarketplace.plugins[0]?.source.path).toBe(`./plugins/${pluginName}`)

    const cursorManifest = await readJsonFile<{
      rules?: string
      skills?: string
      agents?: string
      commands?: string
      hooks?: string
      mcpServers?: string
    }>(path.join(exportRoot, 'cursor', 'plugins', pluginName, '.cursor-plugin', 'plugin.json'))
    expect(cursorManifest.rules).toBe('./rules')
    expect(cursorManifest.skills).toBe('./skills')
    expect(cursorManifest.agents).toBe('./agents')
    expect(cursorManifest.commands).toBe('./commands')
    expect(cursorManifest.hooks).toBe('./hooks/hooks.json')
    expect(cursorManifest.mcpServers).toBe('./mcp.json')

    const cursorMcpContents = await fs.readFile(
      path.join(exportRoot, 'cursor', 'plugins', pluginName, 'mcp.json'),
      'utf-8'
    )
    expect(cursorMcpContents).toContain('"mcpServers"')
  })

  it('installs and safely uninstalls workspace plugins for codex and cursor', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

    await assertVpBuildWorks(project, workspace)
    const { generatedMetaPath } = await scaffoldPack(project, workspace, { consumerSafe: true })

    await runBuiltCli(
      ['plugin', 'install', 'codex', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    const codexPluginDir = path.join(project.dir, 'plugins', pluginName)
    const cursorPluginDir = path.join(project.dir, '.cursor', 'plugins', 'local', pluginName)
    const ledgerPath = path.join(project.dir, '.agentrig', 'plugin-installs.json')

    expect(await pathExists(path.join(codexPluginDir, '.codex-plugin', 'plugin.json'))).toBe(true)
    expect(await pathExists(path.join(cursorPluginDir, '.cursor-plugin', 'plugin.json'))).toBe(true)

    const workspaceLedger = await readJsonFile<{ installs: Record<string, unknown> }>(ledgerPath)
    expect(Object.keys(workspaceLedger.installs)).toEqual(
      expect.arrayContaining([
        `codex:workspace:${pluginName}`,
        `cursor:workspace:${pluginName}`,
      ])
    )

    await appendTextFile(path.join(codexPluginDir, 'README.md'), 'manual edit\n')
    await appendTextFile(path.join(cursorPluginDir, 'README.md'), 'manual edit\n')

    await runBuiltCli(
      ['plugin', 'uninstall', 'codex', generatedMetaPath, '--scope', 'workspace'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      ['plugin', 'uninstall', 'cursor', generatedMetaPath, '--scope', 'workspace'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    expect(await pathExists(path.join(codexPluginDir, 'README.md'))).toBe(true)
    expect(await pathExists(path.join(cursorPluginDir, 'README.md'))).toBe(true)
    expect(await pathExists(path.join(codexPluginDir, '.codex-plugin', 'plugin.json'))).toBe(false)
    expect(await pathExists(path.join(cursorPluginDir, '.cursor-plugin', 'plugin.json'))).toBe(false)

    const ledgerAfterUninstall = await readJsonFile<{ installs: Record<string, unknown> }>(ledgerPath)
    expect(Object.keys(ledgerAfterUninstall.installs)).toHaveLength(0)
  })

  it('installs and uninstalls personal plugins inside an isolated HOME', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

    await assertVpBuildWorks(project, workspace)
    const { generatedMetaPath } = await scaffoldPack(project, workspace, { consumerSafe: true })

    await runBuiltCli(
      ['plugin', 'install', 'codex', generatedMetaPath, '--scope', 'personal', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'personal', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    const codexPluginPath = path.join(
      workspace.homeDir,
      '.codex',
      'plugins',
      pluginName,
      '.codex-plugin',
      'plugin.json'
    )
    const cursorPluginPath = path.join(
      workspace.homeDir,
      '.cursor',
      'plugins',
      'local',
      pluginName,
      '.cursor-plugin',
      'plugin.json'
    )
    const personalLedgerPath = path.join(workspace.homeDir, '.agentrig', 'plugin-installs.json')

    expect(await pathExists(codexPluginPath)).toBe(true)
    expect(await pathExists(cursorPluginPath)).toBe(true)

    const personalLedger = await readJsonFile<{ installs: Record<string, unknown> }>(personalLedgerPath)
    expect(Object.keys(personalLedger.installs)).toEqual(
      expect.arrayContaining([
        `codex:personal:${pluginName}`,
        `cursor:personal:${pluginName}`,
      ])
    )

    await runBuiltCli(
      ['plugin', 'uninstall', 'codex', generatedMetaPath, '--scope', 'personal'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      ['plugin', 'uninstall', 'cursor', generatedMetaPath, '--scope', 'personal'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    expect(await pathExists(codexPluginPath)).toBe(false)
    expect(await pathExists(cursorPluginPath)).toBe(false)

    const personalLedgerAfterUninstall = await readJsonFile<{ installs: Record<string, unknown> }>(
      personalLedgerPath
    )
    expect(Object.keys(personalLedgerAfterUninstall.installs)).toHaveLength(0)
  })

  it('installs and uninstalls Claude plugins for workspace and personal scopes', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

    await assertVpBuildWorks(project, workspace)
    const { generatedMetaPath } = await scaffoldPack(project, workspace, { consumerSafe: true })

    const fakeClaude = await createFakeClaudeEnv(workspace)

    await runBuiltCli(
      ['plugin', 'install', 'claude', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: fakeClaude.env,
      }
    )

    await runBuiltCli(
      ['plugin', 'install', 'claude', generatedMetaPath, '--scope', 'personal', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: fakeClaude.env,
      }
    )

    const workspaceLedger = await readJsonFile<{ installs: Record<string, unknown> }>(
      path.join(project.dir, '.agentrig', 'plugin-installs.json')
    )
    const personalLedger = await readJsonFile<{ installs: Record<string, unknown> }>(
      path.join(workspace.homeDir, '.agentrig', 'plugin-installs.json')
    )
    expect(Object.keys(workspaceLedger.installs)).toContain(`claude:workspace:${pluginName}`)
    expect(Object.keys(personalLedger.installs)).toContain(`claude:personal:${pluginName}`)

    await runBuiltCli(
      ['plugin', 'uninstall', 'claude', generatedMetaPath, '--scope', 'workspace'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: fakeClaude.env,
      }
    )

    await runBuiltCli(
      ['plugin', 'uninstall', 'claude', generatedMetaPath, '--scope', 'personal'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: fakeClaude.env,
      }
    )

    const calls = await readJsonLinesFile<{ args: string[] }>(fakeClaude.logPath)
    expect(calls).toHaveLength(7)
    expect(calls[0]?.args.slice(0, 3)).toEqual(['plugin', 'marketplace', 'add'])
    expect(calls[0]?.args[3]).toBeTruthy()
    expect(calls[1]?.args).toEqual([
      'plugin',
      'install',
      `${pluginName}@agentrig-community`,
      '--scope',
      'project',
    ])
    expect(calls[2]?.args.slice(0, 3)).toEqual(['plugin', 'marketplace', 'add'])
    expect(calls[2]?.args[3]).toBeTruthy()
    expect(calls[3]?.args).toEqual([
      'plugin',
      'install',
      `${pluginName}@agentrig-community`,
      '--scope',
      'user',
    ])
    expect(calls[4]?.args).toEqual([
      'plugin',
      'uninstall',
      `${pluginName}@agentrig-community`,
      '--scope',
      'project',
    ])
    expect(calls[5]?.args).toEqual([
      'plugin',
      'uninstall',
      `${pluginName}@agentrig-community`,
      '--scope',
      'user',
    ])
    expect(calls[6]?.args).toEqual(['plugin', 'marketplace', 'remove', 'agentrig-community'])

    const workspaceLedgerAfter = await readJsonFile<{ installs: Record<string, unknown> }>(
      path.join(project.dir, '.agentrig', 'plugin-installs.json')
    )
    const personalLedgerAfter = await readJsonFile<{ installs: Record<string, unknown> }>(
      path.join(workspace.homeDir, '.agentrig', 'plugin-installs.json')
    )
    expect(Object.keys(workspaceLedgerAfter.installs)).toHaveLength(0)
    expect(Object.keys(personalLedgerAfter.installs)).toHaveLength(0)
  })

  it('supports dry-run, force, and corrupted-ledger plugin cases', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

    await assertVpBuildWorks(project, workspace)
    const { generatedMetaPath } = await scaffoldPack(project, workspace, { consumerSafe: true })

    const fakeClaude = await createFakeClaudeEnv(workspace)

    const dryRun = await runBuiltCli(
      ['plugin', 'install', 'claude', generatedMetaPath, '--scope', 'workspace', '--dryRun', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
        env: fakeClaude.env,
      }
    )
    expect(dryRun.stdout).toContain('claude [workspace]: installed 1, skipped 0')
    const dryRunLedgerPath = path.join(project.dir, '.agentrig', 'plugin-installs.json')
    if (await pathExists(dryRunLedgerPath)) {
      const dryRunLedger = await readJsonFile<{ installs: Record<string, unknown> }>(dryRunLedgerPath)
      expect(Object.keys(dryRunLedger.installs)).toHaveLength(0)
    }
    expect(await pathExists(fakeClaude.logPath)).toBe(false)

    await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    const skipped = await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )
    expect(skipped.stdout).toContain('cursor [workspace]: installed 0, skipped 1')

    const forced = await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'workspace', '--force', '--yes'],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )
    expect(forced.stdout).toContain('cursor [workspace]: installed 1, skipped 0')

    const workspaceLedgerPath = path.join(project.dir, '.agentrig', 'plugin-installs.json')
    await fs.writeFile(workspaceLedgerPath, '{ "schemaVersion": 1, "installs": { "oops": true } }\n', 'utf-8')

    await expect(
      runBuiltCli(
        ['plugin', 'uninstall', 'cursor', generatedMetaPath, '--scope', 'workspace'],
        {
          cwd: project.dir,
          homeDir: workspace.homeDir,
        }
      )
    ).rejects.toThrow('Invalid plugin install ledger')
  })

  it('keeps workspace installs isolated between copied Vite+ projects', async () => {
    workspace = await createE2EWorkspace()
    const projectA = workspace.projects[0]
    const projectB = workspace.projects[1]
    if (!projectA || !projectB) throw new Error('Expected both project-a and project-b fixtures')

    await assertVpBuildWorks(projectA, workspace)
    await assertVpBuildWorks(projectB, workspace)
    const { generatedMetaPath } = await scaffoldPack(projectA, workspace, { consumerSafe: true })
    await initializeProject(projectB, workspace)

    await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: projectA.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      ['plugin', 'install', 'cursor', generatedMetaPath, '--scope', 'workspace', '--yes'],
      {
        cwd: projectB.dir,
        homeDir: workspace.homeDir,
      }
    )

    const projectACursorPlugin = path.join(projectA.dir, '.cursor', 'plugins', 'local', pluginName)
    const projectBCursorPlugin = path.join(projectB.dir, '.cursor', 'plugins', 'local', pluginName)

    expect(await pathExists(path.join(projectACursorPlugin, '.cursor-plugin', 'plugin.json'))).toBe(true)
    expect(await pathExists(path.join(projectBCursorPlugin, '.cursor-plugin', 'plugin.json'))).toBe(true)

    await runBuiltCli(
      ['plugin', 'uninstall', 'cursor', generatedMetaPath, '--scope', 'workspace'],
      {
        cwd: projectA.dir,
        homeDir: workspace.homeDir,
      }
    )

    expect(await pathExists(path.join(projectA.dir, '.agentrig', 'plugin-installs.json'))).toBe(true)
    expect(await pathExists(path.join(projectBCursorPlugin, '.cursor-plugin', 'plugin.json'))).toBe(true)

    const projectALedger = await readJsonFile<{ installs: Record<string, unknown> }>(
      path.join(projectA.dir, '.agentrig', 'plugin-installs.json')
    )
    const projectBLedger = await readJsonFile<{ installs: Record<string, unknown> }>(
      path.join(projectB.dir, '.agentrig', 'plugin-installs.json')
    )
    expect(Object.keys(projectALedger.installs)).toHaveLength(0)
    expect(Object.keys(projectBLedger.installs)).toEqual(
      expect.arrayContaining([`cursor:workspace:${pluginName}`])
    )
  })
})
