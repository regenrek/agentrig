import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { pathExists } from '../lib/fs'
import { getGlobalConfigPath, getProjectConfigPath, writeGlobalConfig, writeProjectConfig } from '../lib/config'
import type { AgentRigConfig } from '../lib/types'

const args = {
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  skillsDir: {
    type: 'string',
    description: 'Where skills are installed (defaults to .codex/skills)',
  },
  registry: {
    type: 'string',
    description: 'Default registry base URL (ex: http://localhost:5173/registry)',
  },
  defaultRig: {
    type: 'string',
    description: 'Default rig name to apply when none is specified',
  },
  minimal: {
    type: 'boolean',
    description: 'Write a minimal project config (useful when rigs live in global config)',
    default: false,
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

const command = defineCommand({
  meta: {
    name: 'init',
    description: 'Create an agentrig config file (project or global).',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const skillsDir = args.skillsDir ?? '.codex/skills'

    // This default is great for this monorepo because the web app serves /registry during dev.
    // In your own projects you will likely override this with a hosted registry URL.
    const defaultRegistry = args.registry ?? 'http://localhost:5173/registry'

    const cfg: AgentRigConfig = args.minimal
      ? {
          $schema: 'https://agentrig.dev/schema/config.json',
          skillsDir,
          defaultRig: args.defaultRig ?? 'core',
          registries: defaultRegistry ? [{ name: 'default', url: defaultRegistry }] : [],
        }
      : {
          $schema: 'https://agentrig.dev/schema/config.json',
          skillsDir,
          registries: defaultRegistry ? [{ name: 'default', url: defaultRegistry }] : [],
          rigs: {
            core: { packs: ['core-committer', 'security-check'] },
            'tauri-agentic': { extends: ['core'], packs: ['solidjs', 'rust'] },
            tui: { extends: ['core'], packs: ['go'] },
            website: { extends: ['core'], packs: ['typescript'] },
          },
          defaultRig: args.defaultRig ?? 'core',
        }

    if (args.global) {
      const p = getGlobalConfigPath()
      if ((await pathExists(p)) && !args.force) {
        throw new Error(`Global config already exists: ${p} (use --force to overwrite)`)
      }
      await writeGlobalConfig(cfg)
      console.log(`Wrote global config: ${p}`)
      return
    }

    const p = getProjectConfigPath(cwd)
    if ((await pathExists(p)) && !args.force) {
      throw new Error(`Project config already exists: ${p} (use --force to overwrite)`)
    }
    await writeProjectConfig(cwd, cfg)
    console.log(`Wrote project config: ${p}`)
  },
})

export default command
