import path from 'node:path'
import { ensureDir, writeJsonFile } from '../fs'
import { getPluginInstallRecordId } from '../plugin-install-ledger'
import type { ClaudePluginInstallRecord } from '../types'
import type {
  PackEntry,
  PackFeatures,
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
  detectPackFeatures,
  normalizeManifestDescription,
  pluginAuthor,
} from './shared'

function scopeToClaudeArg(scope: 'personal' | 'workspace') {
  return scope === 'workspace' ? 'project' : 'user'
}

async function copyClaudePlugin(packDir: string, pluginDir: string) {
  await copyEntries(packDir, pluginDir, [
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
  pack: PackEntry,
  owner: PluginOwner,
  features: PackFeatures
): ClaudePluginManifest {
  return claudePluginManifestSchema.parse({
    name: pack.pluginName,
    description: normalizeManifestDescription(pack.meta),
    version: pack.meta.version,
    ...(pluginAuthor(pack.meta, owner) ? { author: pluginAuthor(pack.meta, owner) } : {}),
    ...(features.hasCommands ? { commands: ['./commands'] } : {}),
    ...(features.hasAgents ? { agents: ['./agents'] } : {}),
  })
}

function buildClaudeMarketplaceManifest(
  cfg: ProviderExportContext['cfg'],
  packs: ProviderExportContext['packs']
): ClaudeMarketplaceManifest {
  return claudeMarketplaceManifestSchema.parse({
    name: cfg.providers.claude.marketplaceName,
    owner: {
      name: cfg.owner.name,
      ...(cfg.owner.email ? { email: cfg.owner.email } : {}),
    },
    metadata: cfg.providers.claude.metadata,
    plugins: packs.map((pack) => ({
      name: pack.pluginName,
      source: pack.pluginName,
      description: pack.meta.description,
      version: pack.meta.version,
      tags: pack.meta.tags,
    })),
  })
}

export const claudeProvider: PluginProviderAdapter = {
  id: 'claude',
  async exportMarketplace({ outRoot, cfg, packs }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    await ensureDir(pluginRoot)
    await ensureDir(path.join(outRoot, '.claude-plugin'))

    for (const pack of packs) {
      const pluginDir = path.join(pluginRoot, pack.pluginName)
      await copyClaudePlugin(pack.packDir, pluginDir)
      const features = await detectPackFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.claude-plugin', 'plugin.json'),
        buildClaudePluginManifest(pack, cfg.owner, features)
      )
    }

    await writeJsonFile(
      path.join(outRoot, '.claude-plugin', 'marketplace.json'),
      buildClaudeMarketplaceManifest(cfg, packs)
    )

    return {
      provider: 'claude',
      outRoot,
      marketplaceName: cfg.providers.claude.marketplaceName,
      plugins: packs,
    }
  },
  previewInstall({ outRoot, packs, scope, cfg }) {
    const scopeArg = scopeToClaudeArg(scope)
    return {
      provider: 'claude',
      scope,
      locations: [outRoot],
      actions: [
        `claude plugin marketplace add ${outRoot}`,
        ...packs.map(
          (pack) =>
            `claude plugin install ${pack.pluginName}@${cfg.providers.claude.marketplaceName} --scope ${scopeArg}`
        ),
      ],
    }
  },
  async install({ result, dryRun, runner, scope, requestedScope }) {
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
      const pluginRef = `${plugin.pluginName}@${result.marketplaceName}`
      await runner('claude', ['plugin', 'install', pluginRef, '--scope', scopeArg])
      installed.push(plugin.pluginName)
      ledgerEntries.push({
        id: getPluginInstallRecordId('claude', scope, plugin.pluginName),
        provider: 'claude',
        requestedScope,
        scope,
        packName: plugin.meta.name,
        packVersion: plugin.meta.version,
        pluginName: plugin.pluginName,
        sourceLocation: result.outRoot,
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
