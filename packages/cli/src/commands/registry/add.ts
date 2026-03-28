import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { readJsonFile, writeJsonFile, ensureDir } from '../../lib/fs'
import { getGlobalConfigPath, getProjectConfigPath } from '../../lib/config'
import { isValidRegistryAlias } from '../../lib/registry-spec'
import { normalizeRegistryUrl } from '../../lib/registry'
import type { AgentRigConfig } from '../../lib/types'

const args = {
  name: {
    type: 'positional',
    description: 'Registry name (a short identifier)',
    required: true,
  },
  url: {
    type: 'positional',
    description: 'Registry base URL (must contain registry.json at root)',
    required: true,
  },
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  global: {
    type: 'boolean',
    description: 'Write to global config (~/.agentrig/config.json)',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

function upsertRegistry(cfg: AgentRigConfig, name: string, url: string) {
  const regs = [...(cfg.registries ?? [])]
  const idx = regs.findIndex((r) => r.name === name)
  if (idx >= 0) regs[idx] = { name, url }
  else regs.push({ name, url })
  return regs
}

function sanitizeConfig(cfg: AgentRigConfig, registries: AgentRigConfig['registries']): AgentRigConfig {
  return {
    $schema: cfg.$schema,
    registries,
    rigs: cfg.rigs,
    defaultRig: cfg.defaultRig,
  }
}

const command = defineCommand({
  meta: { name: 'add', description: 'Add or update a registry in config.' },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const p = args.global ? getGlobalConfigPath() : getProjectConfigPath(cwd)
    const registryName = String(args.name)
    const registryUrl = normalizeRegistryUrl(String(args.url))

    if (!isValidRegistryAlias(registryName)) {
      throw new Error(
        `Invalid registry alias: ${registryName}\n` +
          'Registry aliases must use lowercase letters, numbers, and hyphens.'
      )
    }

    await ensureDir(path.dirname(p))
    const cfg = (await readJsonFile<AgentRigConfig>(p)) ?? {
      $schema: 'https://agentrig.ai/schema/config.json',
    }
    const registries = upsertRegistry(cfg, registryName, registryUrl)
    const nextConfig = sanitizeConfig(cfg, registries)

    await writeJsonFile(p, nextConfig)

    console.log(`Updated config: ${p}`)
    console.log(`Registry: ${registryName} -> ${registryUrl}`)
  },
})

export default command
