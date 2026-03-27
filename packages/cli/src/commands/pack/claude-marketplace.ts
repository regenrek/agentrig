import { defineCommand, showUsage } from 'citty'
import path from 'node:path'
import process from 'node:process'
import { exportPluginProviders, formatProviderSummary } from '../../lib/plugin-providers'

const command = defineCommand({
  meta: {
    name: 'claude-marketplace',
    description: 'Legacy alias for `pack plugin export --agent claude`.',
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
    const [result] = await exportPluginProviders({
      cwd,
      agent: 'claude',
      packsDir: args.packsDir,
      out: path.resolve(cwd, args.out),
      configPath: args.config,
      marketplaceName: args.marketplaceName,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      pluginPrefix: args.pluginPrefix,
      clean: args.clean,
    })

    console.log(formatProviderSummary(result))
    console.log(`Marketplace: ${result.marketplaceName}`)
    console.log(`Plugins dir: ${path.join(result.outRoot, 'plugins')}`)
  },
})

export default command
