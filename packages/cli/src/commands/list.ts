import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../lib/plugin-install-ledger'
import { isUrl, readRegistryIndex } from '../lib/registry'

const args = {
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  installed: {
    type: 'boolean',
    description: 'List installed plugins (default)',
    default: true,
  },
  available: {
    type: 'boolean',
    description: 'List plugins available in registries',
    default: false,
  },
  registry: {
    type: 'string',
    description: 'Registry alias (from config) or a registry base URL',
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

const command = defineCommand({
  meta: {
    name: 'list',
    description: 'List installed plugins and/or available plugins in registries.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)

    if (args.installed) {
      const ledgers = await loadPluginInstallLedgers(cwd)
      const records = listPluginInstallRecords(ledgers).sort((left, right) =>
        `${left.provider}:${left.scope}:${left.pluginId}`.localeCompare(
          `${right.provider}:${right.scope}:${right.pluginId}`
        )
      )
      console.log('Installed plugins:')
      if (!records.length) console.log('  (none)')
      for (const record of records) {
        console.log(`  - ${record.pluginId}@${record.pluginVersion} (${record.provider}, ${record.scope})`)
      }
      console.log('')
    }

    if (!args.available) return

    const registryUrls: string[] = []
    if (args.registry) {
      if (isUrl(args.registry)) registryUrls.push(args.registry)
      else {
        const match = cfg.registries.find((r) => r.name === args.registry)
        if (!match) {
          throw new Error(
            `Registry "${args.registry}" is not configured. Add it first with:\n` +
              `agentrig registry add ${args.registry} <baseUrl>`
          )
        }
        registryUrls.push(match.url)
      }
    } else {
      for (const r of cfg.registries) registryUrls.push(r.url)
    }

    if (!registryUrls.length) {
      console.log('No registries configured. Add one in agentrig.config.json or global config.')
      return
    }

    for (const base of registryUrls) {
      console.log(`Available plugins in: ${base}`)
      try {
        const index = await readRegistryIndex(base)
        if (!index.items?.length) {
          console.log('  (no items)')
          continue
        }
        for (const item of index.items) {
          const v = item.version ? `@${item.version}` : ''
          console.log(`  - ${item.id}${v}  ${item.name}`)
        }
      } catch (e) {
        console.log(`  Error: ${String(e)}`)
      }
      console.log('')
    }
  },
})

export default command
