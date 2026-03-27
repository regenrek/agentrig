import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { installPluginProviders, parsePluginProviderSelector } from '../../lib/plugin-providers'

const command = defineCommand({
  meta: {
    name: 'install',
    description: 'Install exported pack plugins into Claude, Codex, Cursor, or all supported providers.',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Provider to install for: claude, codex, cursor, or all',
      default: 'all',
    },
    packsDir: {
      type: 'string',
      description: 'Directory containing pack folders (each with meta.json).',
      default: 'registry/packs',
    },
    out: {
      type: 'string',
      description: 'Optional export directory to keep after installation. Defaults to a temporary directory.',
    },
    config: {
      type: 'string',
      description: 'Optional config file (defaults to agentrig.plugins.json or agentrig.marketplace.json).',
    },
    marketplaceName: {
      type: 'string',
      description: 'Override the marketplace identifier for the selected provider(s).',
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
    },
    pack: {
      type: 'string',
      description: 'Install a single pack by folder name instead of every pack.',
    },
    scope: {
      type: 'string',
      description: 'Install scope for file-based providers: personal or workspace',
      default: 'personal',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite installed plugin directories if they already exist.',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Show what would be installed without writing files or invoking provider CLIs.',
      default: false,
    },
    clean: {
      type: 'boolean',
      description: 'Remove the explicit output directory before exporting into it.',
      default: true,
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
    if (args.scope !== 'personal' && args.scope !== 'workspace') {
      throw new Error(`Unsupported scope: ${args.scope}`)
    }

    const cwd = process.cwd()
    const provider = parsePluginProviderSelector(args.agent)
    const results = await installPluginProviders({
      cwd,
      agent: provider,
      packsDir: args.packsDir,
      out: args.out ? path.resolve(cwd, args.out) : undefined,
      configPath: args.config,
      marketplaceName: args.marketplaceName,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      pluginPrefix: args.pluginPrefix,
      pack: args.pack,
      scope: args.scope,
      force: args.force,
      dryRun: args.dryRun,
      clean: args.clean,
    })

    for (const result of results) {
      console.log(`${result.provider}: installed ${result.installed.length}, skipped ${result.skipped.length}`)
      for (const location of result.locations) {
        console.log(`  -> ${location}`)
      }
    }
  },
})

export default command
