import path from 'node:path'
import { ensureDir, writeJsonFile } from '../fs'
import { getPluginInstallRecordId } from '../plugin-install-ledger'
import type { ClaudePluginInstallRecord } from '../types'
import type {
  PluginEntry,
  PluginFeatures,
  PluginOwner,
  PluginProviderAdapter,
  ProviderExportContext,
} from './shared'
import {
  claudeMarketplaceManifestSchema,
  claudePluginManifestSchema,
  type ClaudeMarketplaceManifest,
  type ClaudePluginManifest,
} from './schemas'
import {
  copyEntries,
  detectPluginFeatures,
  normalizeManifestDescription,
  pluginAuthor,
} from './shared'

function scopeToClaudeArg(scope: 'personal' | 'workspace') {
  return scope === 'workspace' ? 'project' : 'user'
}

async function copyClaudePlugin(pluginSourceDir: string, pluginDir: string) {
  await copyEntries(pluginSourceDir, pluginDir, [
    'skills',
    'commands',
    'agents',
    'hooks',
    'assets',
    'scripts',
    'README.md',
    'settings.json',
    '.mcp.json',
    { source: 'mcp.json', destination: '.mcp.json' },
    '.lsp.json',
  ])
}

function buildClaudePluginManifest(
  plugin: PluginEntry,
  owner: PluginOwner,
  features: PluginFeatures
): ClaudePluginManifest {
  return claudePluginManifestSchema.parse({
    name: plugin.pluginName,
    description: normalizeManifestDescription(plugin.manifest),
    version: plugin.manifest.version,
    ...(pluginAuthor(plugin.manifest, owner) ? { author: pluginAuthor(plugin.manifest, owner) } : {}),
    ...(features.hasCommands ? { commands: ['./commands'] } : {}),
    ...(features.hasAgents ? { agents: ['./agents'] } : {}),
  })
}

function buildClaudeMarketplaceManifest(
  cfg: ProviderExportContext['cfg'],
  plugins: ProviderExportContext['plugins']
): ClaudeMarketplaceManifest {
  return claudeMarketplaceManifestSchema.parse({
    name: cfg.providers.claude.marketplaceName,
    owner: {
      name: cfg.owner.name,
      ...(cfg.owner.email ? { email: cfg.owner.email } : {}),
    },
    metadata: cfg.providers.claude.metadata,
    plugins: plugins.map((plugin) => ({
      name: plugin.pluginName,
      source: `${cfg.providers.claude.metadata.pluginRoot}/${plugin.pluginName}`,
      description: plugin.manifest.description,
      version: plugin.manifest.version,
      tags: plugin.manifest.keywords,
    })),
  })
}

export const claudeProvider: PluginProviderAdapter = {
  id: 'claude',
  async exportMarketplace({ outRoot, cfg, plugins }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    await ensureDir(pluginRoot)
    await ensureDir(path.join(outRoot, '.claude-plugin'))

    for (const plugin of plugins) {
      const pluginDir = path.join(pluginRoot, plugin.pluginName)
      await copyClaudePlugin(plugin.pluginSourceDir, pluginDir)
      const features = await detectPluginFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.claude-plugin', 'plugin.json'),
        buildClaudePluginManifest(plugin, cfg.owner, features)
      )
    }

    await writeJsonFile(
      path.join(outRoot, '.claude-plugin', 'marketplace.json'),
      buildClaudeMarketplaceManifest(cfg, plugins)
    )

    return {
      provider: 'claude',
      outRoot,
      marketplaceName: cfg.providers.claude.marketplaceName,
      plugins,
    }
  },
  previewInstall({ outRoot, plugins, scope, cfg }) {
    const scopeArg = scopeToClaudeArg(scope)
    return {
      provider: 'claude',
      scope,
      locations: [outRoot],
      actions: [
        `claude plugin marketplace add ${outRoot}`,
        ...plugins.map(
          (plugin) =>
            `claude plugin install ${plugin.pluginName}@${cfg.providers.claude.marketplaceName} --scope ${scopeArg}`
        ),
      ],
    }
  },
  async install({ result, dryRun, runner, scope, requestedScope, installMetadataByPluginId }) {
    const installed: string[] = []
    const skipped: string[] = []
    const locations = [result.outRoot]
    const ledgerEntries: ClaudePluginInstallRecord[] = []
    const scopeArg = scopeToClaudeArg(scope)

    if (dryRun) {
      return {
        provider: 'claude',
        scope,
        installed: result.plugins.map((plugin) => plugin.pluginName),
        skipped,
        locations,
        ledgerEntries,
      }
    }

    let marketplaceAdded = true
    try {
      await runner('claude', ['plugin', 'marketplace', 'add', result.outRoot])
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      if (!message.includes('already')) {
        throw error
      }
      marketplaceAdded = false
    }

    for (const plugin of result.plugins) {
      const installMetadata = installMetadataByPluginId[plugin.manifest.id]
      if (!installMetadata) {
        throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
      }
      const pluginRef = `${plugin.pluginName}@${result.marketplaceName}`
      await runner('claude', ['plugin', 'install', pluginRef, '--scope', scopeArg])
      installed.push(plugin.pluginName)
      ledgerEntries.push({
        id: getPluginInstallRecordId('claude', scope, plugin.pluginName),
        provider: 'claude',
        requestedScope,
        specIdentity: installMetadata.specIdentity,
        registry: installMetadata.registry,
        scope,
        pluginId: plugin.manifest.id,
        pluginVersion: plugin.manifest.version,
        snapshotDigest: installMetadata.snapshotDigest,
        pluginName: plugin.pluginName,
        targetPaths: [result.outRoot],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          marketplaceName: result.marketplaceName,
          pluginRef,
          scopeArg,
          marketplaceSourcePath: result.outRoot,
          marketplaceAdded,
        },
      })
    }

    return {
      provider: 'claude',
      scope,
      installed,
      skipped,
      locations,
      ledgerEntries,
    }
  },
  async uninstall({ entries, remainingEntries, dryRun, runner }) {
    const removed: string[] = []
    const kept: string[] = []
    const missing: string[] = []
    const clearedRecordIds: string[] = []
    const locations = [...new Set(entries.flatMap((entry) => entry.targetPaths))]
    const knownClaudeEntries = [...entries, ...remainingEntries].filter(
      (entry): entry is ClaudePluginInstallRecord => entry.provider === 'claude'
    )

    for (const entry of entries) {
      if (entry.provider !== 'claude') continue
      if (dryRun) {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
        continue
      }

      try {
        await runner('claude', ['plugin', 'uninstall', entry.metadata.pluginRef, '--scope', entry.metadata.scopeArg])
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
        if (message.includes('not installed') || message.includes('not found')) {
          missing.push(entry.pluginName)
          clearedRecordIds.push(entry.id)
          continue
        }
        kept.push(entry.pluginName)
      }
    }

    const marketplacesToRemove = [...new Set(
      entries
        .filter((entry): entry is ClaudePluginInstallRecord => entry.provider === 'claude')
        .map((entry) => entry.metadata.marketplaceName)
        .filter(
          (marketplaceName) =>
            knownClaudeEntries.some(
              (entry) => entry.metadata.marketplaceName === marketplaceName && entry.metadata.marketplaceAdded
            ) &&
            !remainingEntries.some(
              (entry) => entry.provider === 'claude' && entry.metadata.marketplaceName === marketplaceName
            )
        )
    )]

    for (const marketplaceName of marketplacesToRemove) {
      if (dryRun) {
        continue
      }

      try {
        await runner('claude', ['plugin', 'marketplace', 'remove', marketplaceName])
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
        if (!message.includes('not found')) {
          throw error
        }
      }
    }

    return {
      provider: 'claude',
      removed,
      kept,
      missing,
      locations,
      clearedRecordIds,
    }
  },
}
