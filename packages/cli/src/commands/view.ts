import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { resolvePackSpec } from '../lib/pack-resolver'
import { determineTrustTier, describeTrustTier, validateTargetPaths } from '../lib/trust'

const args = {
  spec: {
    type: 'positional',
    description: 'Pack name, registryAlias/pack, or a meta.json URL/path',
    required: true,
  },
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  json: {
    type: 'boolean',
    description: 'Output as JSON',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

function assertPackMeta(meta: any): asserts meta is {
  name: string
  title: string
  description: string
  version: string
  files: Array<{ path: string; target: string; mode?: string; sha256?: string }>
  author?: string
  license?: string
  tags?: string[]
  rigDependencies?: string[]
} {
  if (!meta || typeof meta !== 'object') throw new Error('Invalid pack meta: not an object')
  for (const key of ['name', 'title', 'description', 'version']) {
    if (typeof meta[key] !== 'string' || !meta[key]) throw new Error(`Invalid pack meta: missing ${key}`)
  }
  if (!Array.isArray(meta.files)) throw new Error('Invalid pack meta: files must be an array')
}

function resolveTrustSource(
  spec: string,
  resolved: { source: { type: 'url'; baseUrl: string } | { type: 'fs'; baseDir: string } }
) {
  if (resolved.source.type === 'url') {
    return resolved.source.baseUrl
  }
  return spec
}

const command = defineCommand({
  meta: {
    name: 'view',
    description: 'Inspect a pack before installing.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)

    const spec = args.spec

    const resolved = await resolvePackSpec(spec, cwd, cfg.registries)

    const meta = resolved.meta
    assertPackMeta(meta)
    const trustTier = resolved.trustTier ?? await determineTrustTier(
      resolveTrustSource(spec, resolved),
      cfg.registries
    )

    // Validate target paths
    const pathValidation = validateTargetPaths(meta.files)

    if (args.json) {
      console.log(JSON.stringify({
        name: meta.name,
        title: meta.title,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        license: meta.license,
        tags: meta.tags,
        source: resolved.sourceLabel,
        trustTier,
        files: meta.files,
        rigDependencies: meta.rigDependencies,
        pathValidation,
      }, null, 2))
      return
    }

    // Human-readable output
    console.log(`Name: ${meta.name}`)
    console.log(`Title: ${meta.title}`)
    console.log(`Description: ${meta.description}`)
    console.log(`Version: ${meta.version}`)
    if (meta.author) console.log(`Author: ${meta.author}`)
    if (meta.license) console.log(`License: ${meta.license}`)
    if (meta.tags?.length) console.log(`Tags: ${meta.tags.join(', ')}`)
    console.log(`Source: ${resolved.sourceLabel}`)
    console.log(`Trust: ${describeTrustTier(trustTier)}`)

    if (meta.rigDependencies?.length) {
      console.log('')
      console.log('Dependencies:')
      for (const dep of meta.rigDependencies) {
        console.log(`  - ${dep}`)
      }
    }

    console.log('')
    console.log('Files:')
    for (const f of meta.files) {
      const mode = f.mode ? ` (mode: ${f.mode})` : ''
      const hash = f.sha256 ? ` [${f.sha256.slice(0, 8)}...]` : ''
      console.log(`  ${f.path} -> ${f.target}${mode}${hash}`)
    }

    if (!pathValidation.valid) {
      console.log('')
      console.log('⚠️  Warning: Some target paths are outside allowed directories:')
      for (const p of pathValidation.disallowed) {
        console.log(`  - ${p}`)
      }
    }
  },
})

export default command
