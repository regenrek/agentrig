import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadManifest, saveManifest } from '../lib/manifest'
import { removePack } from '../lib/install'

const args = {
  name: {
    type: 'positional',
    description: 'Installed pack name to remove',
    required: true,
  },
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
    name: 'remove',
    description: 'Remove an installed pack (safe removal using manifest hashes).',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const manifest = await loadManifest(cwd)

    const { removed, kept, missing } = await removePack(cwd, manifest, args.name)
    await saveManifest(cwd, manifest)

    console.log(`Removed pack: ${args.name}`)
    if (removed.length) {
      console.log('')
      console.log('Removed files:')
      for (const f of removed) console.log(`  - ${f}`)
    }
    if (kept.length) {
      console.log('')
      console.log('Kept (changed since install):')
      for (const f of kept) console.log(`  = ${f}`)
    }
    if (missing.length) {
      console.log('')
      console.log('Missing:')
      for (const f of missing) console.log(`  ? ${f}`)
    }
  },
})

export default command
