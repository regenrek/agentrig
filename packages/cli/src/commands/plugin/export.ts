import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import {
  exportPluginProviders,
  formatProviderSummary,
  parsePluginProviderSelector,
} from '../../lib/plugin-providers'

const command = defineCommand({
  meta: {
    name: 'export',
    description: 'Export provider plugin bundles from local plugins.',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Provider to export for: claude, codex, cursor, or all',
      default: 'all',
    },
    pluginsDir: {
      type: 'string',
      description: 'Directory containing plugin folders (each with plugin.json).',
      default: 'plugins',
    },
    out: {
      type: 'string',
      description: 'Output directory. Defaults to dist/<provider>-marketplace or dist/plugins for all.',
    },
    config: {
      type: 'string',
      description: 'Optional config file (defaults to agentrig.plugins.json).',
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
    plugin: {
      type: 'string',
      description: 'Export a single plugin by folder name instead of every plugin.',
    },
    clean: {
      type: 'boolean',
      description: 'Remove the output directory before exporting.',
      default: true,
    },
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = process.cwd()
    const provider = parsePluginProviderSelector(args.agent)
    const results = await exportPluginProviders({
      cwd,
      agent: provider,
      pluginsDir: args.pluginsDir,
      out: args.out ? path.resolve(cwd, args.out) : undefined,
      configPath: args.config,
      marketplaceName: args.marketplaceName,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      pluginPrefix: args.pluginPrefix,
      clean: args.clean,
      plugin: args.plugin,
    })

    for (const result of results) {
      console.log(formatProviderSummary(result))
      console.log(`Marketplace: ${result.marketplaceName}`)
    }
  },
})

export default command
