import { defineCommand, runMain, showUsage } from 'citty'
import packageJson from '../package.json'
import { shouldShowParentUsage } from './lib/command'

const main = defineCommand({
  meta: {
    name: 'agentrig',
    version: packageJson.version,
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
    login: () => import('./commands/login').then((m) => m.default),
    logout: () => import('./commands/logout').then((m) => m.default),
    whoami: () => import('./commands/whoami').then((m) => m.default),
    rig: () => import('./commands/rig').then((m) => m.default),
    registry: () => import('./commands/registry').then((m) => m.default),
    pack: () => import('./commands/pack').then((m) => m.default),
  },
  async run({ args, rawArgs }) {
    if (args.help) {
      return showUsage(main)
    }
    if (shouldShowParentUsage(rawArgs)) {
      return showUsage(main)
    }
  },
})

runMain(main)
