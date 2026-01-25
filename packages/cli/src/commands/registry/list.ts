import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'

const args = {
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

const command = defineCommand({
  meta: { name: 'list', description: 'List configured registries (global + project merged).' },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)

    console.log('Registries:')
    if (!cfg.registries.length) {
      console.log('  (none)')
      return
    }
    for (const r of cfg.registries) {
      console.log(`  - ${r.name}: ${r.url}`)
    }
  },
})

export default command
