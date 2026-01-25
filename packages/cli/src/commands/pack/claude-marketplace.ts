import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import { defineCommand, showUsage } from 'citty'
import { ensureDir, pathExists, removeIfExists, readJsonFile, writeJsonFile } from '../../lib/fs'
import type { PackMeta } from '../../lib/types'

type MarketplaceConfig = {
  name?: string
  owner?: { name?: string; email?: string }
  metadata?: { description?: string; version?: string; pluginRoot?: string }
  pluginPrefix?: string
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

function assertPackMeta(meta: unknown, packDir: string): asserts meta is PackMeta {
  const where = `meta.json in ${packDir}`
  if (!meta || typeof meta !== 'object') throw new Error(`Invalid ${where}: not an object`)
  const record = meta as Record<string, unknown>
  for (const key of ['name', 'title', 'description', 'version']) {
    if (!isNonEmptyString(record[key])) throw new Error(`Invalid ${where}: missing ${key}`)
  }
}

async function copyDir(src: string, dest: string) {
  await ensureDir(dest)
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(destPath))
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function copyPackToPlugin(packDir: string, pluginDir: string) {
  await ensureDir(pluginDir)
  const entries = await fs.readdir(packDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'meta.json') continue
    const src = path.join(packDir, entry.name)
    const dest = path.join(pluginDir, entry.name)
    if (entry.isDirectory()) {
      await copyDir(src, dest)
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(dest))
      await fs.copyFile(src, dest)
    }
  }
}

const command = defineCommand({
  meta: {
    name: 'claude-marketplace',
    description: 'Export packs as a Claude Code plugin marketplace (Option A: many small plugins).',
  },
  args: {
    packsDir: {
      type: 'string',
      description: 'Directory containing pack folders (each with meta.json).',
      default: 'registry/packs',
    },
    out: {
      type: 'string',
      description: 'Output directory for the marketplace.',
      default: 'dist/claude-marketplace',
    },
    marketplaceName: {
      type: 'string',
      description: 'Marketplace identifier (kebab-case).',
    },
    ownerName: {
      type: 'string',
      description: 'Marketplace owner name.',
    },
    ownerEmail: {
      type: 'string',
      description: 'Marketplace owner email (optional).',
    },
    pluginPrefix: {
      type: 'string',
      description: 'Prefix applied to plugin names to avoid collisions.',
      default: 'agentrig-',
    },
    clean: {
      type: 'boolean',
      description: 'Remove the output directory before exporting.',
      default: true,
    },
    config: {
      type: 'string',
      description: 'Optional JSON config file (defaults to agentrig.marketplace.json if present).',
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = process.cwd()
    const packsRoot = path.isAbsolute(args.packsDir) ? args.packsDir : path.join(cwd, args.packsDir)
    const outRoot = path.isAbsolute(args.out) ? args.out : path.join(cwd, args.out)

    const defaultConfigPath = path.join(cwd, 'agentrig.marketplace.json')
    const configPath = args.config
      ? path.isAbsolute(args.config)
        ? args.config
        : path.join(cwd, args.config)
      : (await pathExists(defaultConfigPath))
        ? defaultConfigPath
        : null

    const cfg = (configPath ? await readJsonFile<MarketplaceConfig>(configPath) : null) ?? {}

    const marketplaceName = args.marketplaceName ?? cfg.name ?? 'agentrig-community'
    const ownerName = args.ownerName ?? cfg.owner?.name ?? 'Agentrig'
    const ownerEmail = args.ownerEmail ?? cfg.owner?.email
    const pluginPrefix = args.pluginPrefix ?? cfg.pluginPrefix ?? 'agentrig-'
    const metadata = {
      description: cfg.metadata?.description ?? 'Agentrig packs exported as Claude Code plugins.',
      version: cfg.metadata?.version ?? '1.0.0',
      pluginRoot: cfg.metadata?.pluginRoot ?? './plugins',
    }

    if (!(await pathExists(packsRoot))) {
      throw new Error(`Missing packs directory: ${packsRoot}`)
    }

    if (args.clean) {
      await removeIfExists(outRoot)
    }

    const marketplaceDir = outRoot
    const pluginsDir = path.join(marketplaceDir, 'plugins')
    const marketplaceManifestPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json')

    await ensureDir(pluginsDir)
    await ensureDir(path.dirname(marketplaceManifestPath))

    const packDirs = (await fs.readdir(packsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packsRoot, entry.name))

    const plugins: Array<Record<string, unknown>> = []

    for (const packDir of packDirs) {
      const metaPath = path.join(packDir, 'meta.json')
      if (!(await pathExists(metaPath))) continue

      const raw = await fs.readFile(metaPath, 'utf-8')
      const meta = JSON.parse(raw)
      assertPackMeta(meta, packDir)

      const pluginName = `${pluginPrefix}${meta.name}`
      const pluginDir = path.join(pluginsDir, pluginName)

      await copyPackToPlugin(packDir, pluginDir)

      const pluginManifest: Record<string, unknown> = {
        name: pluginName,
        description: meta.description || meta.title,
        version: meta.version,
      }

      if (await pathExists(path.join(pluginDir, 'commands'))) {
        pluginManifest.commands = ['./commands']
      }
      if (await pathExists(path.join(pluginDir, 'agents'))) {
        pluginManifest.agents = ['./agents']
      }

      await writeJsonFile(path.join(pluginDir, '.claude-plugin', 'plugin.json'), pluginManifest)

      plugins.push({
        name: pluginName,
        source: pluginName,
        description: meta.description,
        version: meta.version,
        tags: meta.tags,
      })
    }

    const marketplaceManifest: Record<string, unknown> = {
      name: marketplaceName,
      owner: {
        name: ownerName,
        ...(ownerEmail ? { email: ownerEmail } : {}),
      },
      metadata,
      plugins,
    }

    await writeJsonFile(marketplaceManifestPath, marketplaceManifest)

    console.log(`Exported ${plugins.length} plugin(s) to: ${marketplaceDir}`)
    console.log(`Marketplace: ${marketplaceName}`)
    console.log(`Plugins dir: ${pluginsDir}`)
  },
})

export default command
