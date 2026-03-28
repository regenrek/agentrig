import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../../lib/config'
import { loadManifest, saveManifest } from '../../lib/manifest'
import { installPack, removePack } from '../../lib/install'

function resolveRigPacks(
  rigs: Record<string, { extends?: string[]; packs?: string[] }>,
  rigName: string,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(rigName)) return []
  seen.add(rigName)

  const rig = rigs[rigName]
  if (!rig) throw new Error(`Unknown rig: ${rigName}`)

  const result: string[] = []

  for (const parent of rig.extends ?? []) {
    result.push(...resolveRigPacks(rigs, parent, seen))
  }
  for (const p of rig.packs ?? []) result.push(p)

  // de-dupe while preserving order
  const out: string[] = []
  const set = new Set<string>()
  for (const p of result) {
    if (set.has(p)) continue
    set.add(p)
    out.push(p)
  }
  return out
}

const args = {
  name: {
    type: 'positional',
    description: 'Rig name to apply (defaults to config.defaultRig)',
    required: false,
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
    description: 'Override skillsDir for this apply',
  },
  force: {
    type: 'boolean',
    description: 'Overwrite files if they already exist',
    default: false,
  },
  prune: {
    type: 'boolean',
    description: 'Remove installed packs that are not part of the rig',
    default: true,
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
    name: 'apply',
    description: 'Apply a rig: install its packs (and optionally prune others).',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)
    const manifest = await loadManifest(cwd)

    const rigName = args.name ?? cfg.defaultRig
    if (!rigName) throw new Error('No rig name provided and config.defaultRig is not set.')

    const packs = resolveRigPacks(cfg.rigs, rigName)
    if (!packs.length) {
      console.log(`Rig "${rigName}" has no packs.`)
      return
    }

    const skillsDir = args.skillsDir ?? cfg.skillsDir

    console.log(`Applying rig: ${rigName}`)
    console.log(`skillsDir: ${skillsDir}`)
    console.log(`packs: ${packs.join(', ')}`)
    console.log('')

    for (const p of packs) {
      const { installed, skipped } = await installPack(p, cfg, manifest, {
        cwd,
        skillsDir,
        force: args.force,
        registry: args.registry,
      })
      console.log(`+ ${p}`)
      if (installed.length) console.log(`    installed: ${installed.length}`)
      if (skipped.length) console.log(`    skipped:   ${skipped.length}`)
    }

    if (args.prune) {
      const want = new Set(packs)
      const installedPacks = Object.keys(manifest.installed)
      const toRemove = installedPacks.filter((p) => !want.has(p))
      if (toRemove.length) {
        console.log('')
        console.log(`Pruning ${toRemove.length} pack(s): ${toRemove.join(', ')}`)
        for (const p of toRemove) {
          const { removed, kept } = await removePack(cwd, manifest, p)
          console.log(`- ${p} (removed: ${removed.length}, kept: ${kept.length})`)
        }
      }
    }

    await saveManifest(cwd, manifest)
    console.log('')
    console.log('Done.')
  },
})

export default command
