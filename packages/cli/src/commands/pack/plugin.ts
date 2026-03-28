import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../../lib/command'

const command = defineCommand({
  meta: {
    name: 'plugin',
    description: 'Author/export workflows for turning local packs into provider plugins.',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    export: () => import('./plugin-export').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
