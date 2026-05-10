import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { resolvePluginSpec } from '../lib/plugin-resolver'
import { installBundleSnapshotDigest } from '../lib/registry'
import { validatePluginPaths } from '../lib/trust'

const args = {
  spec: {
    type: 'positional',
    description: 'Canonical install ref: <registryAlias>/<namespace.plugin>; add @<version> for an explicit pin',
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

const command = defineCommand({
  meta: {
    name: 'view',
    description: 'Inspect a plugin before installing.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
    const cfg = await loadConfig(cwd)

    const spec = args.spec

    const resolved = await resolvePluginSpec(spec, cwd, cfg.registries)
    const listing = resolved.listing
    const installFiles = resolved.file_list

    const pathValidation = validatePluginPaths(installFiles)

    if (args.json) {
      console.log(JSON.stringify({
        id: listing.artifactId,
        name: listing.name,
        description: listing.description,
        version: listing.version,
        author: listing.author,
        license: listing.license,
        keywords: listing.keywords,
        marketplace: {
          alias: listing.registryAlias ?? 'agentrig',
          slug: listing.slug,
        },
        source: resolved.source,
        installability: listing.installability,
        snapshotDigest: installBundleSnapshotDigest(resolved),
        files: installFiles,
        pathValidation,
      }, null, 2))
      return
    }

    // Human-readable output
    console.log(`Id: ${listing.artifactId}`)
    console.log(`Name: ${listing.name}`)
    console.log(`Description: ${listing.description}`)
    console.log(`Version: ${listing.version}`)
    if (listing.author) console.log(`Author: ${listing.author}`)
    if (listing.license) console.log(`License: ${listing.license}`)
    if (listing.keywords?.length) console.log(`Keywords: ${listing.keywords.join(', ')}`)
    console.log(`Marketplace: ${listing.registryAlias ?? 'agentrig'}`)
    if (listing.slug) console.log(`Slug: ${listing.slug}`)
    console.log(`Installability: ${listing.installability}`)
    console.log(`Plugin snapshot: ${installBundleSnapshotDigest(resolved)}`)

    if (installFiles.length) {
      console.log('')
      console.log('Files:')
    }
    for (const f of installFiles) {
      console.log(`  ${f.path} [${f.sha256.slice(0, 15)}...]`)
    }

    if (!pathValidation.valid) {
      console.log('')
      console.log('Warning: Some plugin file paths are invalid:')
      for (const p of pathValidation.disallowed) {
        console.log(`  - ${p}`)
      }
    }
  },
})

export default command
