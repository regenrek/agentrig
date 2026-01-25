import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { loadManifest } from '../lib/manifest'
import { isUrl, readRegistryIndex } from '../lib/registry'

const args = {
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  installed: {
    type: 'boolean',
    description: 'List installed packs (default)',
    default: true,
  },
  available: {
    type: 'boolean',
    description: 'List packs available in registries',
    default: false,
  },
  registry: {
    type: 'string',
    description: 'Registry name (from config) OR a registry base URL',
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
    description: 'List installed packs and/or available packs in registries.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)
    const manifest = await loadManifest(cwd)

    if (args.installed) {
      const names = Object.keys(manifest.installed).sort()
      console.log('Installed packs:')
      if (!names.length) console.log('  (none)')
      for (const name of names) {
        const p = manifest.installed[name]
        console.log(`  - ${p.name}@${p.version} (${p.source})`)
      }
      console.log('')
    }

    if (!args.available) return

    const registryUrls: string[] = []
    if (args.registry) {
      if (isUrl(args.registry)) registryUrls.push(args.registry)
      else {
        const match = cfg.registries.find((r) => r.name === args.registry)
        registryUrls.push(match ? match.url : args.registry)
      }
    } else {
      for (const r of cfg.registries) registryUrls.push(r.url)
    }

    if (!registryUrls.length) {
      console.log('No registries configured. Add one in agentrig.config.json or global config.')
      return
    }

    for (const base of registryUrls) {
      console.log(`Available packs in: ${base}`)
      try {
        const index = await readRegistryIndex(base)
        if (!index.items?.length) {
          console.log('  (no items)')
          continue
        }
        for (const item of index.items) {
          const v = item.version ? `@${item.version}` : ''
          console.log(`  - ${item.name}${v}  ${item.title}`)
        }
      } catch (e) {
        console.log(`  Error: ${String(e)}`)
      }
      console.log('')
    }
  },
})

export default command
