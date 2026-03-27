import { homedir } from 'node:os'
import path from 'node:path'
import { ensureDir, readJsonFile, writeJsonFile } from '../fs'
import { getPluginInstallRecordId } from '../plugin-install-ledger'
import type { CodexPluginInstallRecord } from '../types'
import type {
  FileRemovalSummary,
  PackEntry,
  PackFeatures,
  PluginInstallScope,
  PluginOwner,
  PluginProviderAdapter,
  ProviderExportContext,
} from './shared'
import {
  codexMarketplaceManifestSchema,
  codexMarketplacePluginSchema,
  codexPluginManifestSchema,
  type CodexMarketplaceManifest,
  type CodexMarketplacePlugin,
  type CodexPluginManifest,
} from './schemas'
import {
  copyEntries,
  copyInstalledPlugin,
  detectPackFeatures,
  normalizeManifestDescription,
  pluginAuthor,
  removeInstalledFiles,
} from './shared'

async function copyCodexPlugin(packDir: string, pluginDir: string) {
  await copyEntries(packDir, pluginDir, [
    'skills',
    'assets',
    'README.md',
    '.mcp.json',
    { source: 'mcp.json', destination: '.mcp.json' },
    '.app.json',
  ])
}

function buildCodexPluginManifest(
  pack: PackEntry,
  owner: PluginOwner,
  features: PackFeatures
): CodexPluginManifest {
  return codexPluginManifestSchema.parse({
    name: pack.pluginName,
    version: pack.meta.version,
    description: normalizeManifestDescription(pack.meta),
    ...(pluginAuthor(pack.meta, owner) ? { author: pluginAuthor(pack.meta, owner) } : {}),
    ...(features.hasSkills ? { skills: './skills/' } : {}),
    ...(features.hasClaudeMcp ? { mcpServers: './.mcp.json' } : {}),
    ...(features.hasCodexApp ? { apps: './.app.json' } : {}),
    interface: {
      displayName: pack.meta.title,
      shortDescription: normalizeManifestDescription(pack.meta),
      developerName: pack.meta.author ?? owner.name,
      category: 'Productivity',
    },
  })
}

function buildCodexMarketplaceManifest(
  cfg: ProviderExportContext['cfg'],
  packs: ProviderExportContext['packs'],
  pluginRoot = cfg.providers.codex.pluginRoot
): CodexMarketplaceManifest {
  return codexMarketplaceManifestSchema.parse({
    name: cfg.providers.codex.marketplaceName,
    interface: {
      displayName: cfg.providers.codex.displayName,
    },
    plugins: packs.map((pack) => ({
      name: pack.pluginName,
      source: {
        source: 'local',
        path: `${pluginRoot}/${pack.pluginName}`,
      },
      policy: {
        installation: cfg.providers.codex.installationPolicy,
        authentication: cfg.providers.codex.authenticationPolicy,
      },
      category: cfg.providers.codex.category,
    })),
  })
}

function resolveCodexInstallPaths(cwd: string, scope: PluginInstallScope) {
  if (scope === 'workspace') {
    return {
      pluginRoot: path.join(cwd, 'plugins'),
      marketplacePath: path.join(cwd, '.agents', 'plugins', 'marketplace.json'),
      relativePluginRoot: './plugins',
    }
  }

  const home = homedir()
  return {
    pluginRoot: path.join(home, '.codex', 'plugins'),
    marketplacePath: path.join(home, '.agents', 'plugins', 'marketplace.json'),
    relativePluginRoot: './.codex/plugins',
  }
}

function buildMarketplaceContainer(
  cfg: ProviderExportContext['cfg'],
  rawMarketplace: unknown,
  relativePluginRoot: string
) {
  const fallback = buildCodexMarketplaceManifest(cfg, [], relativePluginRoot)
  if (!rawMarketplace || typeof rawMarketplace !== 'object' || Array.isArray(rawMarketplace)) {
    return {
      raw: {} as Record<string, unknown>,
      name: fallback.name,
      interface: fallback.interface,
      plugins: [] as unknown[],
    }
  }

  const marketplace = rawMarketplace as Record<string, unknown>
  return {
    raw: marketplace,
    name: typeof marketplace.name === 'string' && marketplace.name.trim() ? marketplace.name.trim() : fallback.name,
    interface:
      marketplace.interface && typeof marketplace.interface === 'object'
        ? marketplace.interface
        : fallback.interface,
    plugins: Array.isArray(marketplace.plugins) ? [...marketplace.plugins] : [],
  }
}

function matchesMarketplaceEntry(candidate: unknown, expected: CodexMarketplacePlugin) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false
  }

  const candidateRecord = candidate as {
    name?: unknown
    source?: { source?: unknown; path?: unknown }
  }
  return (
    candidateRecord.name === expected.name &&
    candidateRecord.source?.source === expected.source.source &&
    candidateRecord.source?.path === expected.source.path
  )
}

function summarizePluginRemoval(removal: FileRemovalSummary, marketplaceOutcome: 'removed' | 'missing' | 'kept') {
  if (removal.kept.length > 0 || marketplaceOutcome === 'kept') {
    return 'kept' as const
  }
  if (removal.removed.length > 0 || marketplaceOutcome === 'removed') {
    return 'removed' as const
  }
  return 'missing' as const
}

export const codexProvider: PluginProviderAdapter = {
  id: 'codex',
  async exportMarketplace({ outRoot, cfg, packs }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    const marketplacePath = path.join(outRoot, '.agents', 'plugins', 'marketplace.json')
    await ensureDir(pluginRoot)
    await ensureDir(path.dirname(marketplacePath))

    for (const pack of packs) {
      const pluginDir = path.join(pluginRoot, pack.pluginName)
      await copyCodexPlugin(pack.packDir, pluginDir)
      const features = await detectPackFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.codex-plugin', 'plugin.json'),
        buildCodexPluginManifest(pack, cfg.owner, features)
      )
    }

    await writeJsonFile(marketplacePath, buildCodexMarketplaceManifest(cfg, packs))

    return {
      provider: 'codex',
      outRoot,
      marketplaceName: cfg.providers.codex.marketplaceName,
      plugins: packs,
    }
  },
  previewInstall({ cwd, packs, scope }) {
    const { pluginRoot, marketplacePath } = resolveCodexInstallPaths(cwd, scope)
    return {
      provider: 'codex',
      scope,
      locations: [pluginRoot, marketplacePath, ...packs.map((pack) => path.join(pluginRoot, pack.pluginName))],
      actions: [
        ...packs.map((pack) => `copy ${pack.pluginName} -> ${path.join(pluginRoot, pack.pluginName)}`),
        `update ${marketplacePath}`,
      ],
    }
  },
  async install({ cwd, result, cfg, scope, requestedScope, force, dryRun }) {
    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: CodexPluginInstallRecord[] = []
    const { pluginRoot, marketplacePath, relativePluginRoot } = resolveCodexInstallPaths(cwd, scope)
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')

    const rawMarketplace = await readJsonFile<unknown>(marketplacePath)
    const marketplace = buildMarketplaceContainer(cfg, rawMarketplace, relativePluginRoot)
    const existingPlugins: unknown[] = [...marketplace.plugins]

    for (const pack of result.plugins) {
      const sourceDir = path.join(pluginSourceRoot, pack.pluginName)
      const destinationDir = path.join(pluginRoot, pack.pluginName)
      const copyResult = dryRun
        ? { changed: true, files: [] }
        : await copyInstalledPlugin(sourceDir, destinationDir, force)
      const changed = copyResult.changed
      if (changed) {
        installed.push(pack.pluginName)
      } else {
        skipped.push(pack.pluginName)
      }

      const entry = codexMarketplacePluginSchema.parse({
        name: pack.pluginName,
        source: {
          source: 'local',
          path: `${relativePluginRoot}/${pack.pluginName}`,
        },
        policy: {
          installation: cfg.providers.codex.installationPolicy,
          authentication: cfg.providers.codex.authenticationPolicy,
        },
        category: cfg.providers.codex.category,
      })

      const index = existingPlugins.findIndex(
        (item) =>
          Boolean(item) &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as { name?: string }).name === pack.pluginName
      )
      if (index >= 0) {
        existingPlugins[index] = entry
      } else {
        existingPlugins.push(entry)
      }

      if (changed) {
        ledgerEntries.push({
          id: getPluginInstallRecordId('codex', scope, pack.pluginName),
          provider: 'codex',
          requestedScope,
          scope,
          packName: pack.meta.name,
          packVersion: pack.meta.version,
          pluginName: pack.pluginName,
          sourceLocation: sourceDir,
          targetPaths: [destinationDir, marketplacePath],
          installedAt: new Date().toISOString(),
          files: copyResult.files,
          metadata: {
            pluginPath: destinationDir,
            marketplacePath,
            marketplaceEntry: entry,
          },
        })
      }
    }

    if (!dryRun) {
      await writeJsonFile(
        marketplacePath,
        {
          ...marketplace.raw,
          name: marketplace.name,
          interface: marketplace.interface,
          plugins: existingPlugins,
        }
      )
    }

    return {
      provider: 'codex',
      scope,
      installed,
      skipped,
      locations: [pluginRoot, marketplacePath],
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
      if (entry.provider !== 'codex') continue

      const removal = await removeInstalledFiles(entry.metadata.pluginPath, entry.files, dryRun)
      let marketplaceOutcome: 'removed' | 'missing' | 'kept' = 'missing'
      if (removal.kept.length > 0) {
        marketplaceOutcome = 'kept'
      }
      const rawMarketplace = await readJsonFile<unknown>(entry.metadata.marketplacePath)

      if (marketplaceOutcome === 'kept') {
        // Keep marketplace state untouched when any tracked plugin file was modified.
      } else if (!rawMarketplace || typeof rawMarketplace !== 'object' || Array.isArray(rawMarketplace)) {
        marketplaceOutcome = 'missing'
      } else {
        const marketplace = rawMarketplace as Record<string, unknown>
        const plugins = Array.isArray(marketplace.plugins) ? [...marketplace.plugins] : null
        if (!plugins) {
          marketplaceOutcome = 'kept'
        } else {
          const index = plugins.findIndex((plugin) => matchesMarketplaceEntry(plugin, entry.metadata.marketplaceEntry))
          if (index < 0) {
            marketplaceOutcome = 'missing'
          } else {
            marketplaceOutcome = 'removed'
            if (!dryRun) {
              plugins.splice(index, 1)
              await writeJsonFile(entry.metadata.marketplacePath, {
                ...marketplace,
                plugins,
              })
            }
          }
        }
      }

      const outcome = summarizePluginRemoval(removal, marketplaceOutcome)
      if (outcome === 'removed') {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      } else if (outcome === 'missing') {
        missing.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      } else {
        kept.push(entry.pluginName)
      }
    }

    return {
      provider: 'codex',
      removed,
      kept,
      missing,
      locations,
      clearedRecordIds,
    }
  },
}
