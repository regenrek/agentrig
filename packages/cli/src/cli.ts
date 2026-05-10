#!/usr/bin/env node

import { defineCommand, runCommand, showUsage } from 'citty'
import packageJson from '../package.json'
import { shouldShowParentUsage } from './lib/command'
import { runCliMain } from './lib/run-cli-main'

const main = defineCommand({
  meta: {
    name: 'agentrig',
    version: packageJson.version,
    description: 'Compose and apply skills/workflows via plugins and registries.',
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
    install: () => import('./commands/install').then((m) => m.default),
    search: () => import('./commands/search').then((m) => m.default),
    view: () => import('./commands/view').then((m) => m.default),
    list: () => import('./commands/list').then((m) => m.default),
    inspect: () => import('./commands/inspect').then((m) => m.default),
    use: () => import('./commands/use').then((m) => m.default),
    skill: () => import('./commands/skill').then((m) => m.default),
    mcp: () => import('./commands/mcp').then((m) => m.default),
    hook: () => import('./commands/hook').then((m) => m.default),
    login: () => import('./commands/login').then((m) => m.default),
    logout: () => import('./commands/logout').then((m) => m.default),
    whoami: () => import('./commands/whoami').then((m) => m.default),
    rig: () => import('./commands/rig').then((m) => m.default),
    registry: () => import('./commands/registry').then((m) => m.default),
    plugin: () => import('./commands/plugin').then((m) => m.default),
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

runCliMain({
  main,
  runCommand,
  showUsage,
  meta: { version: packageJson.version },
})
