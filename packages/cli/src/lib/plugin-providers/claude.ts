import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureDir, pathExists, removeIfExists, writeJsonFile } from '../fs'
import { getClaudeMarketplaceCacheRoot } from '../paths'
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
  cleanEmptyAncestors,
  compileProviderMcp,
  copyEntries,
  detectPluginFeatures,
  normalizeManifestDescription,
  normalizeManifestVersion,
  pluginAuthor,
  providerPluginName,
} from './shared'
import { writeClaudeProviderPointer } from './provider-pointers'

/**
 * Stage the rendered Claude marketplace into a persistent directory under
 * `<agentRigHome>/.agentrig/cache/claude-marketplaces/<name>/` so the
 * `claude plugin marketplace add <path>` pointer remains valid after the
 * tempdir-backed `result.outRoot` is cleaned up.
 *
 * Returns the persistent path that should be passed to the Claude CLI.
 */
async function stageClaudeMarketplaceForInstall(
  outRoot: string,
  marketplaceName: string
): Promise<string> {
  const persistentRoot = getClaudeMarketplaceCacheRoot(marketplaceName)
  await ensureDir(path.dirname(persistentRoot))
  // Hard-cut: replace any prior staging contents wholesale so the marketplace
  // matches what we just exported. Atomic replace via mkdtemp -> rename.
  const stagingParent = path.dirname(persistentRoot)
  const stagingDir = await fs.mkdtemp(path.join(stagingParent, `.${path.basename(persistentRoot)}.staging-`))
  let backupDir: string | undefined
  let backupPath: string | undefined
  try {
    await fs.cp(outRoot, stagingDir, { recursive: true, force: true })
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
  return persistentRoot
}

function scopeToClaudeArg(scope: 'personal' | 'workspace') {
  return scope === 'workspace' ? 'project' : 'user'
}

async function copyClaudePlugin(pluginSourceDir: string, pluginDir: string) {
  await copyEntries(pluginSourceDir, pluginDir, [
    'skills',
    { source: 'ai.agentrig/commands', destination: 'commands' },
    { source: 'ai.agentrig/agents', destination: 'agents' },
    { source: 'ai.agentrig/hooks', destination: 'hooks' },
    'assets',
    'scripts',
    'README.md',
    { source: 'ai.agentrig/settings.json', destination: 'settings.json' },
    { source: 'ai.agentrig/lsp.json', destination: '.lsp.json' },
  ])
}

function buildClaudePluginManifest(
  plugin: PluginEntry,
  owner: PluginOwner,
  features: PluginFeatures,
  pluginName: string
): ClaudePluginManifest {
  return claudePluginManifestSchema.parse({
    name: pluginName,
    description: normalizeManifestDescription(plugin.manifest),
    version: normalizeManifestVersion(plugin.manifest),
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
    plugins: plugins.map((plugin) => {
      const pluginName = providerPluginName(plugin, 'claude', cfg.pluginPrefix)
      return {
        name: pluginName,
        source: `${cfg.providers.claude.metadata.pluginRoot}/${pluginName}`,
        description: plugin.manifest.description,
        version: plugin.manifest.version,
        tags: plugin.manifest.keywords,
      }
    }),
  })
}

export const claudeProvider: PluginProviderAdapter = {
  id: 'claude',
  async exportMarketplace({ outRoot, cfg, plugins }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    await ensureDir(pluginRoot)
    await ensureDir(path.join(outRoot, '.claude-plugin'))

    for (const plugin of plugins) {
      const pluginName = providerPluginName(plugin, 'claude', cfg.pluginPrefix)
      const pluginDir = path.join(pluginRoot, pluginName)
      await copyClaudePlugin(plugin.pluginSourceDir, pluginDir)
      await compileProviderMcp(plugin, pluginDir, 'claude', '.mcp.json')
      const features = await detectPluginFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.claude-plugin', 'plugin.json'),
        buildClaudePluginManifest(plugin, cfg.owner, features, pluginName)
      )
      await writeClaudeProviderPointer(pluginDir, plugin, features)
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
  previewInstall({ plugins, scope, cfg }) {
    const scopeArg = scopeToClaudeArg(scope)
    const previewRoot = getClaudeMarketplaceCacheRoot(cfg.providers.claude.marketplaceName)
    return {
      provider: 'claude',
      scope,
      locations: [previewRoot],
      actions: [
        `stage marketplace -> ${previewRoot}`,
        `claude plugin marketplace add ${previewRoot}`,
        ...plugins.map(
          (plugin) => {
            const pluginName = providerPluginName(plugin, 'claude', cfg.pluginPrefix)
            return `claude plugin install ${pluginName}@${cfg.providers.claude.marketplaceName} --scope ${scopeArg}`
          }
        ),
      ],
    }
  },
  async install({ result, cfg, dryRun, runner, scope, requestedScope, installMetadataByPluginId }) {
    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: ClaudePluginInstallRecord[] = []
    const scopeArg = scopeToClaudeArg(scope)
    const previewRoot = getClaudeMarketplaceCacheRoot(result.marketplaceName)

    if (dryRun) {
      return {
        provider: 'claude',
        scope,
        installed: result.plugins.map((plugin) => providerPluginName(plugin, 'claude', cfg.pluginPrefix)),
        skipped,
        locations: [previewRoot],
        ledgerEntries,
      }
    }

    // Stage the freshly exported marketplace into a persistent path so the
    // pointer registered with `claude plugin marketplace add` survives across
    // CLI invocations and tempdir cleanup.
    const persistentMarketplacePath = await stageClaudeMarketplaceForInstall(
      result.outRoot,
      result.marketplaceName
    )

    let marketplaceAdded = true
    try {
      await runner('claude', ['plugin', 'marketplace', 'add', persistentMarketplacePath])
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      if (!message.includes('already')) {
        throw error
      }
      marketplaceAdded = false
    }

    for (const plugin of result.plugins) {
      const pluginName = providerPluginName(plugin, 'claude', cfg.pluginPrefix)
      const installMetadata = installMetadataByPluginId[plugin.manifest.name]
      if (!installMetadata) {
        throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.name}`)
      }
      const pluginRef = `${pluginName}@${result.marketplaceName}`
      await runner('claude', ['plugin', 'install', pluginRef, '--scope', scopeArg])
      installed.push(pluginName)
      ledgerEntries.push({
        id: getPluginInstallRecordId('claude', scope, pluginName),
        provider: 'claude',
        requestedScope,
        specIdentity: installMetadata.specIdentity,
        registry: installMetadata.registry,
        scope,
        pluginId: plugin.manifest.name,
        pluginVersion: normalizeManifestVersion(plugin.manifest),
        snapshotDigest: installMetadata.snapshotDigest,
        pluginName,
        targetPaths: [persistentMarketplacePath],
        installedAt: new Date().toISOString(),
        files: [],
        metadata: {
          marketplaceName: result.marketplaceName,
          pluginRef,
          scopeArg,
          marketplaceSourcePath: persistentMarketplacePath,
          marketplaceAdded,
        },
      })
    }

    return {
      provider: 'claude',
      scope,
      installed,
      skipped,
      locations: [persistentMarketplacePath],
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
    const keptEntries: ClaudePluginInstallRecord[] = []

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
        keptEntries.push(entry)
      }
    }

    const stillInstalledEntries = [...remainingEntries, ...keptEntries]
    const marketplacesToRemove = [...new Set(
      entries
        .filter((entry): entry is ClaudePluginInstallRecord => entry.provider === 'claude')
        .map((entry) => entry.metadata.marketplaceName)
        .filter(
          (marketplaceName) =>
            knownClaudeEntries.some(
              (entry) => entry.metadata.marketplaceName === marketplaceName && entry.metadata.marketplaceAdded
            ) &&
            !stillInstalledEntries.some(
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

      // Best-effort: remove the persistent staging dir we created for this
      // marketplace once no install records reference it anymore.
      const persistentRoot = getClaudeMarketplaceCacheRoot(marketplaceName)
      await removeIfExists(persistentRoot)
      await cleanEmptyAncestors(
        path.dirname(persistentRoot),
        path.dirname(path.dirname(persistentRoot)),
        false
      )
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
