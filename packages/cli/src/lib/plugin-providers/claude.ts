import path from 'node:path'
import { ensureDir, writeJsonFile } from '../fs'
import type { PackEntry, PackFeatures, PluginOwner, PluginProviderAdapter, ProviderExportContext } from './shared'
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
  async install({ result, dryRun, runner }) {
    const installed: string[] = []
    const skipped: string[] = []
    const locations = [result.outRoot]

    if (dryRun) {
      return {
        provider: 'claude',
        installed: result.plugins.map((plugin) => plugin.pluginName),
        skipped,
        locations,
      }
    }

    try {
      await runner('claude', ['plugin', 'marketplace', 'add', result.outRoot])
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      if (!message.includes('already')) {
        throw error
      }
    }

    for (const plugin of result.plugins) {
      await runner('claude', ['plugin', 'install', `${plugin.pluginName}@${result.marketplaceName}`])
      installed.push(plugin.pluginName)
    }

    return {
      provider: 'claude',
      installed,
      skipped,
      locations,
    }
  },
}
