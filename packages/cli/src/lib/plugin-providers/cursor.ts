import { homedir } from 'node:os'
import path from 'node:path'
import { ensureDir, writeJsonFile } from '../fs'
import type { PackEntry, PackFeatures, PluginOwner, PluginProviderAdapter, ProviderExportContext } from './shared'
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
} from './shared'

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
  async install({ result, scope, force, dryRun }) {
    if (scope !== 'personal') {
      throw new Error('Cursor local installs currently support only --scope personal')
    }

    const installed: string[] = []
    const skipped: string[] = []
    const pluginRoot = path.join(homedir(), '.cursor', 'plugins', 'local')
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')

    for (const pack of result.plugins) {
      const sourceDir = path.join(pluginSourceRoot, pack.pluginName)
      const destinationDir = path.join(pluginRoot, pack.pluginName)
      const changed = dryRun ? true : await copyInstalledPlugin(sourceDir, destinationDir, force)
      if (changed) {
        installed.push(pack.pluginName)
      } else {
        skipped.push(pack.pluginName)
      }
    }

    return {
      provider: 'cursor',
      installed,
      skipped,
      locations: [pluginRoot],
    }
  },
}
