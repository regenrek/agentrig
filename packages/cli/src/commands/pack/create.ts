import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import { defineCommand, showUsage } from 'citty'
import { sha256Hex } from '../../lib/hash'
import { writeJsonFile } from '../../lib/fs'
import type { PackMeta, PackFile } from '../../lib/types'

const args = {
  dir: {
    type: 'positional',
    description: 'Pack directory to scan (contains skills/, etc.)',
    required: true,
  },
  name: {
    type: 'string',
    description: 'Pack name (defaults to folder name)',
  },
  title: {
    type: 'string',
    description: 'Human title (defaults to name)',
  },
  description: {
    type: 'string',
    description: 'Description (defaults to empty)',
  },
  version: {
    type: 'string',
    description: 'Version (defaults to 0.1.0)',
    default: '0.1.0',
  },
  out: {
    type: 'string',
    description: 'Output meta.json path (defaults to <dir>/meta.json)',
  },
  force: {
    type: 'boolean',
    description: 'Overwrite existing meta.json',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

async function walkFiles(rootDir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  for (const e of entries) {
    const abs = path.join(rootDir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walkFiles(abs)))
    } else if (e.isFile()) {
      out.push(abs)
    }
  }
  return out
}

function toPosix(p: string) {
  return p.split(path.sep).join('/')
}

function defaultTargetFor(relPosix: string) {
  if (relPosix.startsWith('skills/')) {
    return `{{skillsDir}}/${relPosix.slice('skills/'.length)}`
  }
  return relPosix
}

const command = defineCommand({
  meta: { name: 'create', description: 'Create a meta.json file by scanning a pack directory.' },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = process.cwd()
    const dirAbs = path.isAbsolute(args.dir) ? args.dir : path.join(cwd, args.dir)
    const packName = args.name ?? path.basename(dirAbs)
    const outPath = args.out ? (path.isAbsolute(args.out) ? args.out : path.join(cwd, args.out)) : path.join(dirAbs, 'meta.json')

    if (!args.force) {
      try {
        await fs.access(outPath)
        throw new Error(`Output already exists: ${outPath} (use --force to overwrite)`)
      } catch {
        // ok
      }
    }

    const all = await walkFiles(dirAbs)
    const files: PackFile[] = []

    for (const abs of all) {
      const rel = path.relative(dirAbs, abs)
      if (rel === 'meta.json') continue
      const relPosix = toPosix(rel)
      const buf = await fs.readFile(abs)
      const mode = relPosix.endsWith('.sh') ? '755' : undefined

      files.push({
        path: relPosix,
        target: defaultTargetFor(relPosix),
        mode,
        sha256: sha256Hex(buf),
      })
    }

    const meta: PackMeta = {
      $schema: 'https://agentrig.ai/schema/pack.json',
      kind: 'agentrig:pack',
      name: packName,
      title: args.title ?? packName,
      description: args.description ?? '',
      version: args.version,
      files,
    }

    await writeJsonFile(outPath, meta)
    console.log(`Wrote: ${outPath}`)
    console.log(`Files: ${files.length}`)
  },
})

export default command
