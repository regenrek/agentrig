#!/usr/bin/env node
import { defineCommand, runMain, showUsage } from 'citty'

const main = defineCommand({
  meta: {
    name: 'agentrig',
    version: '0.1.0',
    description: 'Compose and apply skills/workflows via packs and registries.',
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
    init: () => import('./commands/init').then((m) => m.default),
    add: () => import('./commands/add').then((m) => m.default),
    view: () => import('./commands/view').then((m) => m.default),
    list: () => import('./commands/list').then((m) => m.default),
    remove: () => import('./commands/remove').then((m) => m.default),
    rig: () => import('./commands/rig').then((m) => m.default),
    registry: () => import('./commands/registry').then((m) => m.default),
    pack: () => import('./commands/pack').then((m) => m.default),
  },
  async run({ args }) {
    if (args.help) {
      return showUsage(main)
    }
    // Default: show help
    return showUsage(main)
  },
})

runMain(main)
