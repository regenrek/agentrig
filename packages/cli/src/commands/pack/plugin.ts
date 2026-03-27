import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../../lib/command'

const command = defineCommand({
  meta: {
    name: 'plugin',
    description: 'Export or install pack plugins for Claude, Codex, and Cursor.',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    export: () => import('./plugin-export').then((m) => m.default),
    install: () => import('./plugin-install').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
