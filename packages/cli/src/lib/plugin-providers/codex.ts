import { homedir } from 'node:os'
import path from 'node:path'
import { ensureDir, readJsonFile, writeJsonFile } from '../fs'
import type {
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
  async install({ cwd, result, cfg, scope, force, dryRun }) {
    const installed: string[] = []
    const skipped: string[] = []
    const { pluginRoot, marketplacePath, relativePluginRoot } = resolveCodexInstallPaths(cwd, scope)
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')

    const rawMarketplace = await readJsonFile<unknown>(marketplacePath)
    const marketplace = rawMarketplace
      ? codexMarketplaceManifestSchema.parse(rawMarketplace)
      : buildCodexMarketplaceManifest(cfg, [], relativePluginRoot)

    const existingPlugins: CodexMarketplacePlugin[] = [...marketplace.plugins]

    for (const pack of result.plugins) {
      const sourceDir = path.join(pluginSourceRoot, pack.pluginName)
      const destinationDir = path.join(pluginRoot, pack.pluginName)
      const changed = dryRun ? true : await copyInstalledPlugin(sourceDir, destinationDir, force)
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

      const index = existingPlugins.findIndex((item) => item.name === pack.pluginName)
      if (index >= 0) {
        existingPlugins[index] = entry
      } else {
        existingPlugins.push(entry)
      }
    }

    if (!dryRun) {
      await writeJsonFile(
        marketplacePath,
        codexMarketplaceManifestSchema.parse({
        name:
          marketplace.name.trim() || cfg.providers.codex.marketplaceName,
        interface: marketplace.interface,
        plugins: existingPlugins,
        })
      )
    }

    return {
      provider: 'codex',
      installed,
      skipped,
      locations: [pluginRoot, marketplacePath],
    }
  },
}
