import { defineCommand, showUsage } from 'citty'

const command = defineCommand({
  meta: {
    name: 'registry',
    description: 'Manage registries in agentrig config.',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    list: () => import('./registry/list').then((m) => m.default),
    add: () => import('./registry/add').then((m) => m.default),
  },
  run({ args }) {
    if (args.help) return showUsage(command)
    return showUsage(command)
  },
})

export default command
