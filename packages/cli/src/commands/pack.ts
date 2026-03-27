import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../lib/command'

const command = defineCommand({
  meta: {
    name: 'pack',
    description: 'Pack utilities (init, create, bundle, publish, status).',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    init: () => import('./pack/init').then((m) => m.default),
    create: () => import('./pack/create').then((m) => m.default),
    bundle: () => import('./pack/bundle').then((m) => m.default),
    publish: () => import('./pack/publish').then((m) => m.default),
    status: () => import('./pack/status').then((m) => m.default),
    plugin: () => import('./pack/plugin').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
