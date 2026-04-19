import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { pathExists } from '../lib/fs'
import { getGlobalConfigPath, getProjectConfigPath, writeGlobalConfig, writeProjectConfig } from '../lib/config'
import {
  normalizeRegistryUrl,
  OFFICIAL_REGISTRY_ALIAS,
  OFFICIAL_REGISTRY_URL,
} from '../lib/registry'
import type { AgentRigConfig } from '../lib/types'

const args = {
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  registry: {
    type: 'string',
    description: 'Seeded primary registry base URL (defaults to the official registry)',
  },
  global: {
    type: 'boolean',
    description: 'Write to global config (~/.agentrig/config.json) instead of the project config',
    default: false,
  },
  force: {
    type: 'boolean',
    description: 'Overwrite existing config if present',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

function createConfig(registryUrl: string): AgentRigConfig {
  return {
    $schema: 'https://agentrig.ai/schema/config.json',
    registries: [{ name: OFFICIAL_REGISTRY_ALIAS, url: registryUrl }],
  }
}

function printNextSteps() {
  console.log('')
  console.log('Next steps:')
  console.log('  agentrig list --available')
  console.log('  agentrig registry add <alias> <baseUrl>')
  console.log(
    `  agentrig plugin install <provider> ${OFFICIAL_REGISTRY_ALIAS}/${OFFICIAL_REGISTRY_ALIAS}.core-committer@0.1.0`
  )
}

const command = defineCommand({
  meta: {
    name: 'init',
    description: 'Create an agentrig config file (project or global).',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const seededRegistryUrl = normalizeRegistryUrl(String(args.registry ?? OFFICIAL_REGISTRY_URL))
    const cfg = createConfig(seededRegistryUrl)

    if (args.global) {
      const p = getGlobalConfigPath()
      if ((await pathExists(p)) && !args.force) {
        throw new Error(`Global config already exists: ${p} (use --force to overwrite)`)
      }
      await writeGlobalConfig(cfg)
      console.log(`Wrote global config: ${p}`)
      printNextSteps()
      return
    }

    const p = getProjectConfigPath(cwd)
    if ((await pathExists(p)) && !args.force) {
      throw new Error(`Project config already exists: ${p} (use --force to overwrite)`)
    }
    await writeProjectConfig(cwd, cfg)
    console.log(`Wrote project config: ${p}`)
    printNextSteps()
  },
})

export default command
