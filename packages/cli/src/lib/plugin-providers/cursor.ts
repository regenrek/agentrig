import { homedir } from 'node:os'
import path from 'node:path'
import { ensureDir, pathExists, writeJsonFile } from '../fs'
import { getPluginInstallRecordId, loadPluginInstallLedger } from '../plugin-install-ledger'
import { isSamePluginInstallSpecIdentity } from '../plugin-install-spec'
import type { CursorPluginInstallRecord } from '../types'
import type {
  PluginEntry,
  PluginFeatures,
  PluginOwner,
  PluginProviderAdapter,
  ProviderExportContext,
} from './shared'
import {
  cursorMarketplaceManifestSchema,
  cursorPluginManifestSchema,
  type CursorMarketplaceManifest,
  type CursorPluginManifest,
} from './schemas'
import {
  copyEntries,
  copyInstalledPlugin,
  detectPluginFeatures,
  normalizeManifestDescription,
  pluginAuthor,
  removeInstalledFiles,
} from './shared'

function resolveCursorInstallRoot(cwd: string, scope: 'personal' | 'workspace') {
  if (scope === 'workspace') {
    return path.join(cwd, '.cursor', 'plugins', 'local')
  }
  return path.join(homedir(), '.cursor', 'plugins', 'local')
}

async function copyCursorPlugin(pluginSourceDir: string, pluginDir: string) {
  await copyEntries(pluginSourceDir, pluginDir, [
    'rules',
    'skills',
    'agents',
    'commands',
    'hooks',
    'assets',
    'scripts',
    'README.md',
    { source: '.mcp.json', destination: 'mcp.json' },
    'mcp.json',
  ])
}

function buildCursorPluginManifest(
  plugin: PluginEntry,
  owner: PluginOwner,
  features: PluginFeatures
): CursorPluginManifest {
  return cursorPluginManifestSchema.parse({
    name: plugin.pluginName,
    description: normalizeManifestDescription(plugin.manifest),
    version: plugin.manifest.version,
    ...(pluginAuthor(plugin.manifest, owner) ? { author: pluginAuthor(plugin.manifest, owner) } : {}),
    ...(features.hasRules ? { rules: './rules' } : {}),
    ...(features.hasSkills ? { skills: './skills' } : {}),
    ...(features.hasAgents ? { agents: './agents' } : {}),
    ...(features.hasCommands ? { commands: './commands' } : {}),
    ...(features.hasHooks ? { hooks: './hooks/hooks.json' } : {}),
    ...(features.hasClaudeMcp ? { mcpServers: './mcp.json' } : {}),
  })
}

function buildCursorMarketplaceManifest(
  cfg: ProviderExportContext['cfg'],
  plugins: ProviderExportContext['plugins']
): CursorMarketplaceManifest {
  return cursorMarketplaceManifestSchema.parse({
    name: cfg.providers.cursor.marketplaceName,
    owner: {
      name: cfg.owner.name,
      ...(cfg.owner.email ? { email: cfg.owner.email } : {}),
    },
    metadata: {
      description: cfg.providers.cursor.metadata.description,
      version: cfg.providers.cursor.metadata.version,
      pluginRoot: cfg.providers.cursor.metadata.pluginRoot,
    },
    plugins: plugins.map((plugin) => ({
      name: plugin.pluginName,
      source: `${cfg.providers.cursor.metadata.pluginRoot}/${plugin.pluginName}`,
      description: plugin.manifest.description,
      version: plugin.manifest.version,
      ...(pluginAuthor(plugin.manifest, cfg.owner) ? { author: pluginAuthor(plugin.manifest, cfg.owner) } : {}),
      keywords: plugin.manifest.keywords,
    })),
  })
}

export const cursorProvider: PluginProviderAdapter = {
  id: 'cursor',
  async exportMarketplace({ outRoot, cfg, plugins }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    const marketplacePath = path.join(outRoot, '.cursor-plugin', 'marketplace.json')
    await ensureDir(pluginRoot)
    await ensureDir(path.dirname(marketplacePath))

    for (const plugin of plugins) {
      const pluginDir = path.join(pluginRoot, plugin.pluginName)
      await copyCursorPlugin(plugin.pluginSourceDir, pluginDir)
      const features = await detectPluginFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.cursor-plugin', 'plugin.json'),
        buildCursorPluginManifest(plugin, cfg.owner, features)
      )
    }

    await writeJsonFile(marketplacePath, buildCursorMarketplaceManifest(cfg, plugins))

    return {
      provider: 'cursor',
      outRoot,
      marketplaceName: cfg.providers.cursor.marketplaceName,
      plugins,
    }
  },
  previewInstall({ cwd, plugins, scope }) {
    const pluginRoot = resolveCursorInstallRoot(cwd, scope)
    return {
      provider: 'cursor',
      scope,
      locations: [pluginRoot, ...plugins.map((plugin) => path.join(pluginRoot, plugin.pluginName))],
      actions: plugins.map((plugin) => `copy ${plugin.pluginName} -> ${path.join(pluginRoot, plugin.pluginName)}`),
    }
  },
  async install({ cwd, result, scope, requestedScope, specIdentitiesByPluginId, force, dryRun }) {
    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: CursorPluginInstallRecord[] = []
    const pluginRoot = resolveCursorInstallRoot(cwd, scope)
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')
    const installLedger = dryRun ? null : await loadPluginInstallLedger(cwd, scope)

    for (const plugin of result.plugins) {
      const specIdentity = specIdentitiesByPluginId[plugin.manifest.id]
      if (!specIdentity) {
        throw new Error(`Missing install spec identity for plugin: ${plugin.manifest.id}`)
      }

      const destinationDir = path.join(pluginRoot, plugin.pluginName)
      const existingRecordId = getPluginInstallRecordId('cursor', scope, plugin.pluginName)
      const destinationExists = dryRun ? false : await pathExists(destinationDir)
      if (!destinationExists || force) continue

      const existingRecord = installLedger?.installs[existingRecordId]
      if (!existingRecord) {
        throw new Error(
          `Cursor plugin ${plugin.pluginName} already exists at ${destinationDir} without a matching AgentRig ledger entry. Re-run with --force to repair.`
        )
      }
      if (!isSamePluginInstallSpecIdentity(existingRecord.specIdentity, specIdentity)) {
        throw new Error(
          `Cursor plugin ${plugin.pluginName} already exists at ${destinationDir} for a different AgentRig source. Re-run with --force to replace it.`
        )
      }
    }

    for (const plugin of result.plugins) {
      const sourceDir = path.join(pluginSourceRoot, plugin.pluginName)
      const destinationDir = path.join(pluginRoot, plugin.pluginName)
      const copyResult = dryRun
        ? { changed: true, files: [] }
        : await copyInstalledPlugin(sourceDir, destinationDir, force)
      const changed = copyResult.changed
      if (changed) {
        installed.push(plugin.pluginName)
      } else {
        skipped.push(plugin.pluginName)
      }

      if (changed) {
        const specIdentity = specIdentitiesByPluginId[plugin.manifest.id]
        ledgerEntries.push({
          id: getPluginInstallRecordId('cursor', scope, plugin.pluginName),
          provider: 'cursor',
          requestedScope,
          specIdentity,
          scope,
          pluginId: plugin.manifest.id,
          pluginVersion: plugin.manifest.version,
          pluginName: plugin.pluginName,
          sourceLocation: sourceDir,
          targetPaths: [destinationDir],
          installedAt: new Date().toISOString(),
          files: copyResult.files,
          metadata: {
            pluginPath: destinationDir,
          },
        })
      }
    }

    return {
      provider: 'cursor',
      scope,
      installed,
      skipped,
      locations: [pluginRoot],
      ledgerEntries,
    }
  },
  async uninstall({ entries, dryRun }) {
    const removed: string[] = []
    const kept: string[] = []
    const missing: string[] = []
    const clearedRecordIds: string[] = []
    const locations = [...new Set(entries.flatMap((entry) => entry.targetPaths))]

    for (const entry of entries) {
      if (entry.provider !== 'cursor') continue
      const summary = await removeInstalledFiles(entry.metadata.pluginPath, entry.files, dryRun)
      if (summary.kept.length > 0) {
        kept.push(entry.pluginName)
        continue
      }
      if (summary.removed.length > 0) {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
        continue
      }
      missing.push(entry.pluginName)
      clearedRecordIds.push(entry.id)
    }

    return {
      provider: 'cursor',
      removed,
      kept,
      missing,
      locations,
      clearedRecordIds,
    }
  },
}
