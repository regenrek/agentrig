import { defineCommand, showUsage } from 'citty'

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
    'claude-marketplace': () => import('./pack/claude-marketplace').then((m) => m.default),
  },
  run({ args }) {
    if (args.help) return showUsage(command)
    return showUsage(command)
  },
})

export default command
