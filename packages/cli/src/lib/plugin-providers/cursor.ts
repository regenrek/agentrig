import path from 'node:path'
import { ensureDir, pathExists, writeJsonFile } from '../fs'
import { getAgentRigHome } from '../paths'
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
  cleanEmptyAncestors,
  copyEntries,
  copyInstalledPlugin,
  detectPluginFeatures,
  assertContainedPath,
  normalizeManifestDescription,
  pluginAuthor,
  providerPluginName,
  removeInstalledFiles,
} from './shared'

function resolveCursorInstallRoot(cwd: string, scope: 'personal' | 'workspace') {
  if (scope === 'workspace') {
    return path.join(cwd, '.cursor', 'plugins', 'local')
  }
  return path.join(getAgentRigHome(), '.cursor', 'plugins', 'local')
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
  features: PluginFeatures,
  pluginName: string
): CursorPluginManifest {
  return cursorPluginManifestSchema.parse({
    name: pluginName,
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
    plugins: plugins.map((plugin) => {
      const pluginName = providerPluginName(plugin, 'cursor', cfg.pluginPrefix)
      return {
        name: pluginName,
        source: `${cfg.providers.cursor.metadata.pluginRoot}/${pluginName}`,
        description: plugin.manifest.description,
        version: plugin.manifest.version,
        ...(pluginAuthor(plugin.manifest, cfg.owner) ? { author: pluginAuthor(plugin.manifest, cfg.owner) } : {}),
        keywords: plugin.manifest.keywords,
      }
    }),
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
      const pluginName = providerPluginName(plugin, 'cursor', cfg.pluginPrefix)
      const pluginDir = path.join(pluginRoot, pluginName)
      await copyCursorPlugin(plugin.pluginSourceDir, pluginDir)
      const features = await detectPluginFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.cursor-plugin', 'plugin.json'),
        buildCursorPluginManifest(plugin, cfg.owner, features, pluginName)
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
  previewInstall({ cwd, plugins, scope, cfg }) {
    const pluginRoot = resolveCursorInstallRoot(cwd, scope)
    const providerNames = plugins.map((plugin) => providerPluginName(plugin, 'cursor', cfg.pluginPrefix))
    return {
      provider: 'cursor',
      scope,
      locations: [pluginRoot, ...providerNames.map((pluginName) => path.join(pluginRoot, pluginName))],
      actions: providerNames.map((pluginName) => `copy ${pluginName} -> ${path.join(pluginRoot, pluginName)}`),
    }
  },
  async install({ cwd, result, cfg, scope, requestedScope, installMetadataByPluginId, force, dryRun }) {
    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: CursorPluginInstallRecord[] = []
    const pluginRoot = resolveCursorInstallRoot(cwd, scope)
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')
    const installLedger = dryRun ? null : await loadPluginInstallLedger(cwd, scope)

    for (const plugin of result.plugins) {
      const pluginName = providerPluginName(plugin, 'cursor', cfg.pluginPrefix)
      const installMetadata = installMetadataByPluginId[plugin.manifest.id]
      if (!installMetadata) {
        throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
      }

      const destinationDir = path.join(pluginRoot, pluginName)
      const existingRecordId = getPluginInstallRecordId('cursor', scope, pluginName)
      const destinationExists = dryRun ? false : await pathExists(destinationDir)
      if (!destinationExists || force) continue

      const existingRecord = installLedger?.installs[existingRecordId]
      if (!existingRecord) {
        throw new Error(
          `Cursor plugin ${pluginName} already exists at ${destinationDir} without a matching AgentRig ledger entry. Re-run with --force to repair.`
        )
      }
      if (!isSamePluginInstallSpecIdentity(existingRecord.specIdentity, installMetadata.specIdentity)) {
        throw new Error(
          `Cursor plugin ${pluginName} already exists at ${destinationDir} for a different AgentRig source. Re-run with --force to replace it.`
        )
      }
    }

    for (const plugin of result.plugins) {
      const pluginName = providerPluginName(plugin, 'cursor', cfg.pluginPrefix)
      const sourceDir = path.join(pluginSourceRoot, pluginName)
      const destinationDir = path.join(pluginRoot, pluginName)
      const copyResult = dryRun
        ? { changed: true, files: [] }
        : await copyInstalledPlugin(sourceDir, destinationDir, force)
      const changed = copyResult.changed
      if (changed) {
        installed.push(pluginName)
      } else {
        skipped.push(pluginName)
      }

      if (changed) {
        const installMetadata = installMetadataByPluginId[plugin.manifest.id]
        if (!installMetadata) {
          throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
        }
        ledgerEntries.push({
          id: getPluginInstallRecordId('cursor', scope, pluginName),
          provider: 'cursor',
          requestedScope,
          specIdentity: installMetadata.specIdentity,
          registry: installMetadata.registry,
          scope,
          pluginId: plugin.manifest.id,
          pluginVersion: plugin.manifest.version,
          snapshotDigest: installMetadata.snapshotDigest,
          pluginName,
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
  async uninstall({ cwd, entries, dryRun }) {
    const removed: string[] = []
    const kept: string[] = []
    const missing: string[] = []
    const clearedRecordIds: string[] = []
    const locations = new Set<string>()

    for (const entry of entries) {
      if (entry.provider !== 'cursor') continue
      const pluginRoot = resolveCursorInstallRoot(cwd, entry.scope)
      const pluginPath = assertContainedPath(
        pluginRoot,
        entry.metadata.pluginPath,
        'Cursor plugin install'
      )
      locations.add(pluginPath)
      const summary = await removeInstalledFiles(pluginPath, entry.files, dryRun)
      if (summary.kept.length > 0) {
        kept.push(entry.pluginName)
        continue
      }
      if (summary.removed.length > 0) {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      } else {
        missing.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      }
      if (!dryRun) {
        await cleanEmptyAncestors(pluginPath, pluginRoot, dryRun).catch(() => {})
      }
    }

    return {
      provider: 'cursor',
      removed,
      kept,
      missing,
      locations: [...locations],
      clearedRecordIds,
    }
  },
}
