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
    description: 'Export pack plugins for one provider or all supported providers.',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Provider to export for: claude, codex, cursor, or all',
      default: 'all',
    },
    packsDir: {
      type: 'string',
      description: 'Directory containing pack folders (each with meta.json).',
      default: 'registry/packs',
    },
    out: {
      type: 'string',
      description: 'Output directory. Defaults to dist/<provider>-marketplace or dist/plugins for all.',
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
      description: 'Export a single pack by folder name instead of every pack.',
    },
    clean: {
      type: 'boolean',
      description: 'Remove the output directory before exporting.',
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

    const cwd = process.cwd()
    const provider = parsePluginProviderSelector(args.agent)
    const results = await exportPluginProviders({
      cwd,
      agent: provider,
      packsDir: args.packsDir,
      out: args.out ? path.resolve(cwd, args.out) : undefined,
      configPath: args.config,
      marketplaceName: args.marketplaceName,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      pluginPrefix: args.pluginPrefix,
      clean: args.clean,
      pack: args.pack,
    })

    for (const result of results) {
      console.log(formatProviderSummary(result))
      console.log(`Marketplace: ${result.marketplaceName}`)
    }
  },
})

export default command
