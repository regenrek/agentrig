import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendTextFile,
  cleanupE2EWorkspace,
  createE2EWorkspace,
  populateFullPackContents,
  readJsonFile,
  runBuiltCli,
  type E2EProject,
  type E2EWorkspace,
} from '../helpers/e2e'

const registryUrl = 'https://agentrig.ai/registry'
const packName = 'full-e2e-pack'
const packTitle = 'Full E2E Pack'
const packDescription = 'Fixture pack for Vite E2E tests.'
const pluginName = `agentrig-${packName}`

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function initializeProject(project: E2EProject, workspace: E2EWorkspace) {
  await runBuiltCli(['init', '--registry', registryUrl], {
    cwd: project.dir,
    homeDir: workspace.homeDir,
  })
}

async function scaffoldPack(project: E2EProject, workspace: E2EWorkspace) {
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
  await populateFullPackContents(packDir)

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
      path.join(packDir, 'meta.generated.json'),
    ],
    {
      cwd: project.dir,
      homeDir: workspace.homeDir,
    }
  )

  return { packDir }
}

describe.sequential('e2e:vite-playground', () => {
  let workspace: E2EWorkspace | null = null

  afterEach(async () => {
    await cleanupE2EWorkspace(workspace)
    workspace = null
  })

  it('initializes a Vite project, scaffolds a pack, and exports all provider layouts', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

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

    await scaffoldPack(project, workspace)

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'install',
        '--agent',
        'codex',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--scope',
        'workspace',
        '--clean',
      ],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'install',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--scope',
        'workspace',
        '--clean',
      ],
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
      [
        'pack',
        'plugin',
        'uninstall',
        '--agent',
        'codex',
        '--pack',
        packName,
        '--scope',
        'workspace',
      ],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'uninstall',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--scope',
        'workspace',
      ],
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
    expect(Object.keys(ledgerAfterUninstall.installs)).toEqual(
      expect.arrayContaining([
        `codex:workspace:${pluginName}`,
        `cursor:workspace:${pluginName}`,
      ])
    )
  })

  it('installs and uninstalls personal plugins inside an isolated HOME', async () => {
    workspace = await createE2EWorkspace()
    const project = workspace.projects[0]
    if (!project) throw new Error('Missing project-a fixture')

    await scaffoldPack(project, workspace)

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'install',
        '--agent',
        'codex',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--scope',
        'personal',
        '--clean',
      ],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'install',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--scope',
        'personal',
        '--clean',
      ],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    const codexPluginPath = path.join(workspace.homeDir, '.codex', 'plugins', pluginName, '.codex-plugin', 'plugin.json')
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
      [
        'pack',
        'plugin',
        'uninstall',
        '--agent',
        'codex',
        '--pack',
        packName,
        '--scope',
        'personal',
      ],
      {
        cwd: project.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'uninstall',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--scope',
        'personal',
      ],
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

  it('keeps workspace installs isolated between copied Vite projects', async () => {
    workspace = await createE2EWorkspace()
    const projectA = workspace.projects[0]
    const projectB = workspace.projects[1]
    if (!projectA || !projectB) throw new Error('Expected both project-a and project-b fixtures')

    await scaffoldPack(projectA, workspace)
    await initializeProject(projectB, workspace)

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'install',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--scope',
        'workspace',
        '--clean',
      ],
      {
        cwd: projectA.dir,
        homeDir: workspace.homeDir,
      }
    )

    await runBuiltCli(
      [
        'pack',
        'plugin',
        'install',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--packsDir',
        workspace.packsRoot,
        '--scope',
        'workspace',
        '--clean',
      ],
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
      [
        'pack',
        'plugin',
        'uninstall',
        '--agent',
        'cursor',
        '--pack',
        packName,
        '--scope',
        'workspace',
      ],
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
