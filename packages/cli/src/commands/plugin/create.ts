import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import { defineCommand, showUsage } from 'citty'
import { writeJsonFile } from '../../lib/fs'
import type { PluginManifest } from '../../lib/types'

const args = {
  dir: {
    type: 'positional',
    description: 'Plugin directory to scan (contains .plugin/, skills/, etc.)',
    required: true,
  },
  id: {
    type: 'string',
    description: 'Plugin id (defaults to folder name)',
  },
  name: {
    type: 'string',
    description: 'Human-readable plugin name (defaults to derived from id)',
  },
  description: {
    type: 'string',
    description: 'Plugin description',
  },
  version: {
    type: 'string',
    description: 'Version (defaults to 0.1.0)',
    default: '0.1.0',
  },
  out: {
    type: 'string',
    description: 'Output plugin manifest path (defaults to <dir>/.plugin/plugin.json)',
  },
  force: {
    type: 'boolean',
    description: 'Overwrite existing plugin manifest',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

function deriveDisplayName(id: string) {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const command = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a .plugin/plugin.json manifest for a plugin directory.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = process.cwd()
    const dirAbs = path.isAbsolute(args.dir) ? args.dir : path.join(cwd, args.dir)
    const pluginId = args.id ?? path.basename(dirAbs)
    const outPath = args.out
      ? (path.isAbsolute(args.out) ? args.out : path.join(cwd, args.out))
      : path.join(dirAbs, '.plugin', 'plugin.json')

    if (!args.force) {
      try {
        await fs.access(outPath)
        throw new Error(`Output already exists: ${outPath} (use --force to overwrite)`)
      } catch {
        // ok
      }
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true })

    const manifest: PluginManifest = {
      $schema: 'https://agentrig.ai/schema/plugin.v1.json',
      name: pluginId,
      description: args.description ?? `${deriveDisplayName(pluginId)} plugin for AgentRig`,
      version: args.version,
      'x-agentrig': {
        displayName: args.name ?? deriveDisplayName(pluginId),
      },
    }

    await writeJsonFile(outPath, manifest)
    console.log(`Wrote: ${outPath}`)
    console.log(`Plugin id: ${pluginId}`)
  },
})

export default command
