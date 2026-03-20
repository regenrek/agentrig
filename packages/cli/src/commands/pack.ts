import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../lib/command'

const command = defineCommand({
  meta: {
    name: 'pack',
    description: 'Pack utilities (init, create, export).',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    init: () => import('./pack/init').then((m) => m.default),
    create: () => import('./pack/create').then((m) => m.default),
    bundle: () => import('./pack/bundle').then((m) => m.default),
    'claude-marketplace': () => import('./pack/claude-marketplace').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
