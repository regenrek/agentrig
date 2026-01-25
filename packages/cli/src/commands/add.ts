import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { loadManifest, saveManifest } from '../lib/manifest'
import { installPack } from '../lib/install'
import { describeTrustTier } from '../lib/trust'

const args = {
  spec: {
    type: 'positional',
    description: 'Pack name, @namespace/pack, or a meta.json URL/path',
    required: true,
  },
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  registry: {
    type: 'string',
    description: 'Registry name (from config) OR a registry base URL',
  },
  skillsDir: {
    type: 'string',
    description: 'Override skillsDir for this install',
  },
  force: {
    type: 'boolean',
    description: 'Overwrite files if they already exist',
    default: false,
  },
  dryRun: {
    type: 'boolean',
    description: 'Print what would happen, but do not write files',
    default: false,
  },
  yes: {
    type: 'boolean',
    alias: 'y',
    description: 'Skip confirmation prompts for unlisted sources',
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
    name: 'add',
    description: 'Install a pack into the current project.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)
    const manifest = await loadManifest(cwd)

    const skillsDir = args.skillsDir ?? cfg.skillsDir

    // Build install config with both legacy and namespaced registries
    const installConfig = {
      registries: cfg.registries ?? [],
      namespacedRegistries: cfg.namespacedRegistries,
    }

    const { installed, skipped, trustTier } = await installPack(
      args.spec,
      installConfig,
      manifest,
      {
        cwd,
        skillsDir,
        force: args.force,
        dryRun: args.dryRun,
        registry: args.registry,
        yes: args.yes,
      }
    )

    if (!args.dryRun) {
      await saveManifest(cwd, manifest)
    }

    console.log(`Pack installed: ${args.spec}`)
    if (trustTier) {
      console.log(`Trust: ${describeTrustTier(trustTier)}`)
    }
    if (installed.length) {
      console.log('')
      console.log('Installed:')
      for (const f of installed) console.log(`  + ${f}`)
    }
    if (skipped.length) {
      console.log('')
      console.log('Skipped (already exists, use --force to overwrite):')
      for (const f of skipped) console.log(`  = ${f}`)
    }
  },
})

export default command
