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
  meta: {
    name: 'list',
    description: 'List rig profiles from config.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)

    const names = Object.keys(cfg.rigs).sort()
    console.log('Rigs:')
    if (!names.length) {
      console.log('  (none)')
      return
    }
    for (const name of names) {
      const rig = cfg.rigs[name]
      const packs = rig.packs ?? []
      const ext = rig.extends ?? []
      const parts: string[] = []
      if (ext.length) parts.push(`extends: ${ext.join(', ')}`)
      if (packs.length) parts.push(`packs: ${packs.join(', ')}`)
      console.log(`  - ${name}${cfg.defaultRig === name ? ' (default)' : ''}`)
      if (parts.length) console.log(`      ${parts.join(' | ')}`)
    }
  },
})

export default command
