import { defineCommand, showUsage } from 'citty'
import { shouldShowParentUsage } from '../lib/command'

const command = defineCommand({
  meta: {
    name: 'plugin',
    description: 'Plugin utilities for authoring, exporting, installing, and submission.',
  },
  args: {
    help: { type: 'boolean', alias: 'h', description: 'Show help', default: false },
  },
  subCommands: {
    init: () => import('./plugin/init').then((m) => m.default),
    create: () => import('./plugin/create').then((m) => m.default),
    bundle: () => import('./plugin/bundle').then((m) => m.default),
    submit: () => import('./plugin/submit').then((m) => m.default),
    status: () => import('./plugin/status').then((m) => m.default),
    export: () => import('./plugin/export').then((m) => m.default),
    install: () => import('./plugin/install').then((m) => m.default),
    uninstall: () => import('./plugin/uninstall').then((m) => m.default),
  },
  run({ args, rawArgs }) {
    if (args.help) return showUsage(command)
    if (shouldShowParentUsage(rawArgs)) return showUsage(command)
  },
})

export default command
