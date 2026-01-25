import { defineCommand, showUsage } from 'citty'

const command = defineCommand({
  meta: {
    name: 'rig',
    description: 'Work with rig profiles (named sets of packs).',
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
  run({ args }) {
    if (args.help) return showUsage(command)
    return showUsage(command)
  },
})

export default command
