import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  exportPluginProviders,
  installPluginProviders,
  type ExternalCommandRunner,
} from '../../src/lib/plugin-providers'

type TempWorkspace = {
  rootDir: string
  packsRoot: string
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

async function writeText(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf-8')
}

async function createWorkspace(): Promise<TempWorkspace> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-providers-'))
  const packsRoot = path.join(rootDir, 'packs')
  const packDir = path.join(packsRoot, 'sample-pack')

  await writeJson(path.join(packDir, 'meta.json'), {
    name: 'sample-pack',
    title: 'Sample Pack',
    description: 'Sample description',
    version: '1.0.0',
    author: 'Example Team',
    tags: ['demo'],
  })
  await writeText(path.join(packDir, 'README.md'), '# Sample Pack\n')
  await writeText(
    path.join(packDir, 'skills', 'reviewer', 'SKILL.md'),
    '---\nname: reviewer\ndescription: Review code\n---\nReview code carefully.\n'
  )
  await writeText(path.join(packDir, 'commands', 'deploy.md'), 'Deploy command\n')
  await writeText(path.join(packDir, 'agents', 'reviewer.md'), 'Reviewer agent\n')
  await writeText(
    path.join(packDir, 'hooks', 'hooks.json'),
    '{ "hooks": { "PostToolUse": [] } }\n'
  )
  await writeText(
    path.join(packDir, 'rules', 'prefer-const.mdc'),
    '---\ndescription: Prefer const\nalwaysApply: true\n---\nUse const.\n'
  )
  await writeText(path.join(packDir, '.mcp.json'), '{ "mcpServers": { "demo": { "command": "demo" } } }\n')
  await writeText(path.join(packDir, '.app.json'), '{ "apps": [] }\n')

  return { rootDir, packsRoot }
}

describe('plugin providers', () => {
  let workspace: TempWorkspace | null = null
  let originalHome = ''

  beforeEach(() => {
    originalHome = process.env.HOME || ''
  })

  afterEach(async () => {
    if (workspace) {
      await fs.rm(workspace.rootDir, { recursive: true, force: true })
      workspace = null
    }
    process.env.HOME = originalHome
  })

  it('exports all provider marketplace layouts', async () => {
    workspace = await createWorkspace()
    const outRoot = path.join(workspace.rootDir, 'dist')

    const results = await exportPluginProviders({
      cwd: workspace.rootDir,
      agent: 'all',
      packsDir: workspace.packsRoot,
      out: outRoot,
      clean: true,
    })

    expect(results.map((result) => result.provider)).toEqual(['claude', 'codex', 'cursor'])

    const claudePluginManifest = JSON.parse(
      await fs.readFile(
        path.join(outRoot, 'claude', 'plugins', 'agentrig-sample-pack', '.claude-plugin', 'plugin.json'),
        'utf-8'
      )
    )
    expect(claudePluginManifest.name).toBe('agentrig-sample-pack')
    expect(claudePluginManifest.commands).toEqual(['./commands'])
    expect(claudePluginManifest.agents).toEqual(['./agents'])

    const codexPluginManifest = JSON.parse(
      await fs.readFile(
        path.join(outRoot, 'codex', 'plugins', 'agentrig-sample-pack', '.codex-plugin', 'plugin.json'),
        'utf-8'
      )
    )
    expect(codexPluginManifest.skills).toBe('./skills/')
    expect(codexPluginManifest.mcpServers).toBe('./.mcp.json')
    expect(codexPluginManifest.apps).toBe('./.app.json')

    const codexMarketplace = JSON.parse(
      await fs.readFile(path.join(outRoot, 'codex', '.agents', 'plugins', 'marketplace.json'), 'utf-8')
    )
    expect(codexMarketplace.plugins[0].source.path).toBe('./plugins/agentrig-sample-pack')

    const cursorPluginManifest = JSON.parse(
      await fs.readFile(
        path.join(outRoot, 'cursor', 'plugins', 'agentrig-sample-pack', '.cursor-plugin', 'plugin.json'),
        'utf-8'
      )
    )
    expect(cursorPluginManifest.rules).toBe('./rules')
    expect(cursorPluginManifest.skills).toBe('./skills')
    expect(cursorPluginManifest.mcpServers).toBe('./mcp.json')

    const cursorMcpFile = await fs.readFile(
      path.join(outRoot, 'cursor', 'plugins', 'agentrig-sample-pack', 'mcp.json'),
      'utf-8'
    )
    expect(cursorMcpFile).toContain('"mcpServers"')

    const cursorMarketplace = JSON.parse(
      await fs.readFile(path.join(outRoot, 'cursor', '.cursor-plugin', 'marketplace.json'), 'utf-8')
    )
    expect(cursorMarketplace.plugins[0].source).toBe('plugins/agentrig-sample-pack')
  })

  it('installs providers using provider-specific flows', async () => {
    workspace = await createWorkspace()
    const fakeHome = path.join(workspace.rootDir, 'home')
    process.env.HOME = fakeHome

    const calls: Array<{ command: string; args: string[] }> = []
    const runner: ExternalCommandRunner = async (command, args) => {
      calls.push({ command, args })
    }

    const results = await installPluginProviders({
      cwd: workspace.rootDir,
      agent: 'all',
      packsDir: workspace.packsRoot,
      out: path.join(workspace.rootDir, 'generated'),
      scope: 'personal',
      force: true,
      clean: true,
      commandRunner: runner,
    })

    expect(results.map((result) => result.provider)).toEqual(['claude', 'codex', 'cursor'])
    expect(calls).toEqual([
      {
        command: 'claude',
        args: ['plugin', 'marketplace', 'add', path.join(workspace.rootDir, 'generated', 'claude')],
      },
      {
        command: 'claude',
        args: ['plugin', 'install', 'agentrig-sample-pack@agentrig-community'],
      },
    ])

    const codexPluginPath = path.join(fakeHome, '.codex', 'plugins', 'agentrig-sample-pack', '.codex-plugin', 'plugin.json')
    const codexPluginManifest = JSON.parse(await fs.readFile(codexPluginPath, 'utf-8'))
    expect(codexPluginManifest.name).toBe('agentrig-sample-pack')

    const codexMarketplacePath = path.join(fakeHome, '.agents', 'plugins', 'marketplace.json')
    const codexMarketplace = JSON.parse(await fs.readFile(codexMarketplacePath, 'utf-8'))
    expect(codexMarketplace.plugins[0].source.path).toBe('./.codex/plugins/agentrig-sample-pack')

    const cursorPluginPath = path.join(fakeHome, '.cursor', 'plugins', 'local', 'agentrig-sample-pack', '.cursor-plugin', 'plugin.json')
    const cursorPluginManifest = JSON.parse(await fs.readFile(cursorPluginPath, 'utf-8'))
    expect(cursorPluginManifest.name).toBe('agentrig-sample-pack')
  })
})
