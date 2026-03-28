import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../lib/command'

const command = defineCommand({
  meta: {
    name: 'plugin',
    description: 'Install or uninstall provider plugins from resolved pack specs.',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    install: () => import('./plugin/install').then((m) => m.default),
    uninstall: () => import('./plugin/uninstall').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
