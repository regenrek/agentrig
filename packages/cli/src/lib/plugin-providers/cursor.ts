import { homedir } from 'node:os'
import path from 'node:path'
import { ensureDir, writeJsonFile } from '../fs'
import { getPluginInstallRecordId } from '../plugin-install-ledger'
import type { CursorPluginInstallRecord } from '../types'
import type {
  PackEntry,
  PackFeatures,
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
  detectPackFeatures,
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

async function copyCursorPlugin(packDir: string, pluginDir: string) {
  await copyEntries(packDir, pluginDir, [
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
  pack: PackEntry,
  owner: PluginOwner,
  features: PackFeatures
): CursorPluginManifest {
  return cursorPluginManifestSchema.parse({
    name: pack.pluginName,
    description: normalizeManifestDescription(pack.meta),
    version: pack.meta.version,
    ...(pluginAuthor(pack.meta, owner) ? { author: pluginAuthor(pack.meta, owner) } : {}),
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
  packs: ProviderExportContext['packs']
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
    plugins: packs.map((pack) => ({
      name: pack.pluginName,
      source: `${cfg.providers.cursor.metadata.pluginRoot}/${pack.pluginName}`,
      description: pack.meta.description,
      version: pack.meta.version,
      ...(pluginAuthor(pack.meta, cfg.owner) ? { author: pluginAuthor(pack.meta, cfg.owner) } : {}),
      keywords: pack.meta.tags,
    })),
  })
}

export const cursorProvider: PluginProviderAdapter = {
  id: 'cursor',
  async exportMarketplace({ outRoot, cfg, packs }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    const marketplacePath = path.join(outRoot, '.cursor-plugin', 'marketplace.json')
    await ensureDir(pluginRoot)
    await ensureDir(path.dirname(marketplacePath))

    for (const pack of packs) {
      const pluginDir = path.join(pluginRoot, pack.pluginName)
      await copyCursorPlugin(pack.packDir, pluginDir)
      const features = await detectPackFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.cursor-plugin', 'plugin.json'),
        buildCursorPluginManifest(pack, cfg.owner, features)
      )
    }

    await writeJsonFile(marketplacePath, buildCursorMarketplaceManifest(cfg, packs))

    return {
      provider: 'cursor',
      outRoot,
      marketplaceName: cfg.providers.cursor.marketplaceName,
      plugins: packs,
    }
  },
  previewInstall({ cwd, packs, scope }) {
    const pluginRoot = resolveCursorInstallRoot(cwd, scope)
    return {
      provider: 'cursor',
      scope,
      locations: [pluginRoot, ...packs.map((pack) => path.join(pluginRoot, pack.pluginName))],
      actions: packs.map((pack) => `copy ${pack.pluginName} -> ${path.join(pluginRoot, pack.pluginName)}`),
    }
  },
  async install({ cwd, result, scope, requestedScope, force, dryRun }) {
    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: CursorPluginInstallRecord[] = []
    const pluginRoot = resolveCursorInstallRoot(cwd, scope)
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')

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

      if (changed) {
        ledgerEntries.push({
          id: getPluginInstallRecordId('cursor', scope, pack.pluginName),
          provider: 'cursor',
          requestedScope,
          scope,
          packName: pack.meta.name,
          packVersion: pack.meta.version,
          pluginName: pack.pluginName,
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
