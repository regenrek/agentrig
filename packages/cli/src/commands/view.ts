import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { isNamespacedPack } from '../lib/namespace'
import {
  resolvePackByName,
  resolvePackFromMetaSpec,
  resolvePackFromNamespacedRegistry,
  isUrl,
} from '../lib/registry'
import { determineTrustTier, describeTrustTier, validateTargetPaths } from '../lib/trust'

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

    // Resolve the pack
    let resolved
    if (isUrl(spec) || spec.endsWith('.json') || spec.startsWith('.') || spec.startsWith('/')) {
      resolved = await resolvePackFromMetaSpec(spec, cwd)
    } else if (isNamespacedPack(spec) && cfg.namespacedRegistries) {
      resolved = await resolvePackFromNamespacedRegistry(spec, cfg.namespacedRegistries)
    } else {
      resolved = await resolvePackByName(spec, cfg.registries ?? [], args.registry)
    }

    const meta = resolved.meta
    const trustTier = resolved.trustTier ?? await determineTrustTier(
      spec,
      cfg.namespacedRegistries
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
