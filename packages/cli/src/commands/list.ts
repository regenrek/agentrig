import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../lib/plugin-install-ledger'
import {
  OFFICIAL_REGISTRY_ALIAS,
  OFFICIAL_REGISTRY_URL,
  readRegistryIndex,
  resolveConfiguredRegistry,
} from '../lib/registry'
import type { RegistryRef } from '../lib/types'

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
    description: 'Registry alias (from config)',
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

    const registries: RegistryRef[] = []
    if (args.registry) {
      registries.push(resolveConfiguredRegistry(String(args.registry), cfg.registries))
    } else if (cfg.registries.length > 0) {
      registries.push(...cfg.registries.map((registry) => resolveConfiguredRegistry(registry.name, cfg.registries)))
    } else {
      registries.push({
        name: OFFICIAL_REGISTRY_ALIAS,
        url: OFFICIAL_REGISTRY_URL,
      })
    }

    if (!registries.length) {
      console.log('No registries configured. Add one in agentrig.config.json or global config.')
      return
    }

    for (const registry of registries) {
      console.log(`Available plugins in: ${registry.name} (${registry.url})`)
      try {
        const index = await readRegistryIndex(registry)
        if (!index.items?.length) {
          console.log('  (no items)')
          continue
        }
        for (const item of index.items) {
          console.log(
            `  - ${registry.name}/${item.plugin}@${item.latest_version}  ${item.name} [${item.trust_tier}]`
          )
        }
      } catch (e) {
        console.log(`  Error: ${String(e)}`)
      }
      console.log('')
    }
  },
})

export default command
