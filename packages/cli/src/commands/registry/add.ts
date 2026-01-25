import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { readJsonFile, writeJsonFile, ensureDir } from '../../lib/fs'
import { getGlobalConfigPath, getProjectConfigPath } from '../../lib/config'
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
  const regs = cfg.registries ?? []
  const idx = regs.findIndex((r) => r.name === name)
  if (idx >= 0) regs[idx] = { name, url }
  else regs.push({ name, url })
  cfg.registries = regs
}

const command = defineCommand({
  meta: { name: 'add', description: 'Add or update a registry in config.' },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const p = args.global ? getGlobalConfigPath() : getProjectConfigPath(cwd)

    await ensureDir(path.dirname(p))
    const cfg = (await readJsonFile<AgentRigConfig>(p)) ?? {
      $schema: 'https://agentrig.dev/schema/config.json',
    }

    upsertRegistry(cfg, args.name, args.url)
    await writeJsonFile(p, cfg)

    console.log(`Updated config: ${p}`)
    console.log(`Registry: ${args.name} -> ${args.url}`)
  },
})

export default command
