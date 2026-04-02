import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../lib/command'

const command = defineCommand({
  meta: {
    name: 'rig',
    description: 'Work with rig profiles (named sets of plugins).',
  },
  args: {
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  subCommands: {
    list: () => import('./rig/list').then((m) => m.default),
    apply: () => import('./rig/apply').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
