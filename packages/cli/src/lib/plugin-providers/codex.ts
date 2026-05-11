import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureDir, pathExists, removeIfExists, writeJsonFile } from '../fs'
import { getCodexMarketplaceCacheRoot } from '../paths'
import { getPluginInstallRecordId } from '../plugin-install-ledger'
import type { CodexPluginInstallRecord } from '../types'
import { codexInstallPlugin, codexUninstallPlugin, type CodexInstallResult } from './codex-app-server'
import type {
  PluginEntry,
  PluginFeatures,
  PluginInstallScope,
  PluginInstallScopeSelector,
  PluginOwner,
  PluginProviderAdapter,
  ProviderExportContext,
} from './shared'
import {
  codexMarketplaceManifestSchema,
  codexMarketplacePluginSchema,
  codexPluginManifestSchema,
  type CodexMarketplaceManifest,
  type CodexPluginManifest,
} from './schemas'
import {
  copyEntries,
  detectPluginFeatures,
  normalizeManifestDescription,
  pluginAuthor,
  providerPluginName,
} from './shared'

async function copyCodexPlugin(pluginSourceDir: string, pluginDir: string) {
  await copyEntries(pluginSourceDir, pluginDir, [
    'skills',
    'assets',
    'README.md',
    '.mcp.json',
    { source: 'mcp.json', destination: '.mcp.json' },
    '.app.json',
  ])
}

function buildCodexPluginManifest(
  plugin: PluginEntry,
  owner: PluginOwner,
  features: PluginFeatures,
  pluginName: string
): CodexPluginManifest {
  return codexPluginManifestSchema.parse({
    name: pluginName,
    version: plugin.manifest.version,
    description: normalizeManifestDescription(plugin.manifest),
    ...(pluginAuthor(plugin.manifest, owner) ? { author: pluginAuthor(plugin.manifest, owner) } : {}),
    ...(features.hasSkills ? { skills: './skills/' } : {}),
    ...(features.hasClaudeMcp ? { mcpServers: './.mcp.json' } : {}),
    ...(features.hasCodexApp ? { apps: './.app.json' } : {}),
    interface: {
      displayName: plugin.manifest.name,
      shortDescription: normalizeManifestDescription(plugin.manifest),
      developerName: plugin.manifest.author ?? owner.name,
      category: 'Productivity',
    },
  })
}

function buildCodexMarketplaceManifest(
  cfg: ProviderExportContext['cfg'],
  plugins: ProviderExportContext['plugins'],
  pluginRoot = cfg.providers.codex.pluginRoot
): CodexMarketplaceManifest {
  return codexMarketplaceManifestSchema.parse({
    name: cfg.providers.codex.marketplaceName,
    interface: {
      displayName: cfg.providers.codex.displayName,
    },
    plugins: plugins.map((plugin) => {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      return {
        name: pluginName,
        source: {
          source: 'local',
          path: `${pluginRoot}/${pluginName}`,
        },
        policy: {
          installation: cfg.providers.codex.installationPolicy,
          authentication: cfg.providers.codex.authenticationPolicy,
        },
        category: cfg.providers.codex.category,
      }
    }),
  })
}

async function stageCodexMarketplaceForInstall(outRoot: string, marketplaceName: string) {
  const persistentRoot = getCodexMarketplaceCacheRoot(marketplaceName)
  await ensureDir(path.dirname(persistentRoot))
  const stagingParent = path.dirname(persistentRoot)
  const stagingDir = await fs.mkdtemp(path.join(stagingParent, `.${path.basename(persistentRoot)}.staging-`))
  let backupDir: string | undefined
  let backupPath: string | undefined

  try {
    await fs.cp(path.join(outRoot, 'plugins'), path.join(stagingDir, 'plugins'), { recursive: true, force: true })
    const marketplacePath = path.join(stagingDir, '.agents', 'plugins', 'marketplace.json')
    await ensureDir(path.dirname(marketplacePath))
    await fs.copyFile(path.join(outRoot, '.agents', 'plugins', 'marketplace.json'), marketplacePath)

    if (await pathExists(persistentRoot)) {
      backupDir = await fs.mkdtemp(path.join(stagingParent, `.${path.basename(persistentRoot)}.backup-`))
      backupPath = path.join(backupDir, path.basename(persistentRoot))
      await fs.rename(persistentRoot, backupPath)
      await fs.rename(stagingDir, persistentRoot)
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
      backupDir = undefined
      backupPath = undefined
    } else {
      await fs.rename(stagingDir, persistentRoot)
    }
  } catch (error) {
    await removeIfExists(stagingDir)
    if (backupPath && await pathExists(backupPath)) {
      await removeIfExists(persistentRoot)
      await fs.rename(backupPath, persistentRoot)
    }
    if (backupDir) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    }
    throw error
  }

  return {
    root: persistentRoot,
    marketplacePath: path.join(persistentRoot, '.agents', 'plugins', 'marketplace.json'),
  }
}

const CODEX_PLUGIN_SCOPE_ERROR = [
  'Codex plugins only support --scope personal (Codex itself has no workspace-scoped plugin concept).',
  '',
  'Use:',
  '  agentrig plugin install codex <plugin> --scope personal',
  '',
  'For workspace-scoped skill installs, use:',
  '  agentrig skill install codex <skill> --scope workspace',
].join('\n')

const CODEX_CLI_REQUIRED_ERROR = [
  'Codex CLI >= 0.113.0 is required to install AgentRig Codex plugins.',
  '',
  'AgentRig does not edit ~/.agents/plugins/marketplace.json directly because that file is shared user state.',
  '',
  'Install Codex:',
  '  - brew install openai/openai/codex',
  '  - or: npm install -g @openai/codex',
  '  - or: download Codex.app from https://openai.com/codex',
  '',
  'If you already installed Codex.app, run `which codex` to check that the codex CLI is on your $PATH.',
].join('\n')

export function assertCodexPluginPersonalScope(scope: PluginInstallScope | PluginInstallScopeSelector) {
  if (scope !== 'personal') {
    throw new Error(CODEX_PLUGIN_SCOPE_ERROR)
  }
}

function failCodexAppServer(result: Exclude<CodexInstallResult, { ok: true }>): never {
  if (result.reason === 'codex_not_installed' || result.reason === 'codex_too_old') {
    throw new Error(CODEX_CLI_REQUIRED_ERROR)
  }
  throw new Error(result.detail)
}

export const codexProvider: PluginProviderAdapter = {
  id: 'codex',
  async exportMarketplace({ outRoot, cfg, plugins }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    const marketplacePath = path.join(outRoot, '.agents', 'plugins', 'marketplace.json')
    await ensureDir(pluginRoot)
    await ensureDir(path.dirname(marketplacePath))

    for (const plugin of plugins) {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      const pluginDir = path.join(pluginRoot, pluginName)
      await copyCodexPlugin(plugin.pluginSourceDir, pluginDir)
      const features = await detectPluginFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.codex-plugin', 'plugin.json'),
        buildCodexPluginManifest(plugin, cfg.owner, features, pluginName)
      )
    }

    await writeJsonFile(marketplacePath, buildCodexMarketplaceManifest(cfg, plugins))

    return {
      provider: 'codex',
      outRoot,
      marketplaceName: cfg.providers.codex.marketplaceName,
      plugins,
    }
  },
  previewInstall({ plugins, scope, cfg }) {
    assertCodexPluginPersonalScope(scope)
    const previewRoot = getCodexMarketplaceCacheRoot(cfg.providers.codex.marketplaceName)
    const providerPlugins = plugins.map((plugin) => providerPluginName(plugin, 'codex', cfg.pluginPrefix))
    return {
      provider: 'codex',
      scope,
      locations: [previewRoot],
      actions: [
        `stage marketplace -> ${previewRoot}`,
        ...providerPlugins.map(
          (pluginName) => `codex app-server plugin/install ${pluginName}@${cfg.providers.codex.marketplaceName}`
        ),
      ],
    }
  },
  async install({ result, cfg, scope, requestedScope, installMetadataByPluginId, dryRun, enable }) {
    assertCodexPluginPersonalScope(scope)
    const previewRoot = getCodexMarketplaceCacheRoot(result.marketplaceName)
    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: CodexPluginInstallRecord[] = []

    if (dryRun) {
      return {
        provider: 'codex',
        scope,
        installed: result.plugins.map((plugin) => providerPluginName(plugin, 'codex', cfg.pluginPrefix)),
        skipped,
        locations: [previewRoot],
        ledgerEntries,
      }
    }

    const staged = await stageCodexMarketplaceForInstall(result.outRoot, result.marketplaceName)

    for (const plugin of result.plugins) {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      const installMetadata = installMetadataByPluginId[plugin.manifest.id]
      if (!installMetadata) {
        throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
      }
      const entry = codexMarketplacePluginSchema.parse({
        name: pluginName,
        source: {
          source: 'local',
          path: `./plugins/${pluginName}`,
        },
        policy: {
          installation: cfg.providers.codex.installationPolicy,
          authentication: cfg.providers.codex.authenticationPolicy,
        },
        category: cfg.providers.codex.category,
      })
      const installResult = await codexInstallPlugin({
        marketplaceName: result.marketplaceName,
        pluginName,
        version: plugin.manifest.version,
        sourcePath: staged.marketplacePath,
        enable,
      })

      if (!installResult.ok) {
        failCodexAppServer(installResult)
      }

      installed.push(pluginName)
      if (enable) {
        console.log(`Installed and enabled ${pluginName} in Codex (${installResult.installPath}).`)
      } else {
        console.log(`Installed ${pluginName} in Codex (disabled). Press Space in Codex TUI under /plugins to enable.`)
      }
      ledgerEntries.push({
        id: getPluginInstallRecordId('codex', scope, pluginName),
        provider: 'codex',
        requestedScope,
        specIdentity: installMetadata.specIdentity,
        registry: installMetadata.registry,
        scope,
        pluginId: plugin.manifest.id,
        pluginVersion: plugin.manifest.version,
        snapshotDigest: installMetadata.snapshotDigest,
        pluginName,
        targetPaths: [installResult.installPath, staged.marketplacePath],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          pluginPath: installResult.installPath,
          marketplacePath: staged.marketplacePath,
          marketplaceEntry: entry,
          marketplaceName: result.marketplaceName,
          pluginRef: `${pluginName}@${result.marketplaceName}`,
          appServerInstalled: true,
        },
      })
    }

    return {
      provider: 'codex',
      scope,
      installed,
      skipped,
      locations: [staged.root, ...ledgerEntries.map((entry) => entry.metadata.pluginPath)],
      ledgerEntries,
    }
  },
  async uninstall({ entries, dryRun }) {
    const removed: string[] = []
    const kept: string[] = []
    const missing: string[] = []
    const clearedRecordIds: string[] = []
    const locations = new Set<string>()

    for (const entry of entries) {
      if (entry.provider !== 'codex') continue
      for (const targetPath of entry.targetPaths) {
        locations.add(targetPath)
      }
      assertCodexPluginPersonalScope(entry.scope)
      const marketplaceName = entry.metadata.marketplaceName
      if (!marketplaceName) {
        throw new Error(`Codex install ledger entry for ${entry.pluginName} is missing marketplace metadata.`)
      }

      if (dryRun) {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
        continue
      }

      const uninstallResult = await codexUninstallPlugin({
        marketplaceName,
        pluginName: entry.pluginName,
      })
      if (uninstallResult.ok) {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
        continue
      }
      if (/not found|not installed/i.test(uninstallResult.detail)) {
        missing.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
        continue
      }

      failCodexAppServer(uninstallResult)
    }

    return {
      provider: 'codex',
      removed,
      kept,
      missing,
      locations: [...locations],
      clearedRecordIds,
    }
  },
}
