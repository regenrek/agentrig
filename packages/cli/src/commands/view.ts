import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { resolvePluginSpec } from '../lib/plugin-resolver'
import { describeTrustTier, validatePluginPaths } from '../lib/trust'

const args = {
  spec: {
    type: 'positional',
    description: 'Canonical install ref: <registryAlias>/<namespace.plugin>@<version>',
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
    const manifest = resolved.manifest
    const installFiles = resolved.lockArtifact.file_digests
    const trustTier = resolved.trustTier

    const pathValidation = validatePluginPaths(installFiles)

    if (args.json) {
      console.log(JSON.stringify({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
        license: manifest.license,
        keywords: manifest.keywords,
        registry: {
          alias: resolved.registry.name,
          url: resolved.registry.url,
          generatedAt: resolved.registryDocument.generated_at,
          signedDigest: resolved.registryDocument.signature.signed_digest,
        },
        source: resolved.sourceLabel,
        trustTier,
        installability: resolved.installability,
        snapshotDigest: resolved.snapshotDigest,
        files: installFiles,
        pluginDependencies: resolved.lockArtifact.dependencies,
        pathValidation,
      }, null, 2))
      return
    }

    // Human-readable output
    console.log(`Id: ${manifest.id}`)
    console.log(`Name: ${manifest.name}`)
    console.log(`Description: ${manifest.description}`)
    console.log(`Version: ${manifest.version}`)
    if (manifest.author) console.log(`Author: ${manifest.author}`)
    if (manifest.license) console.log(`License: ${manifest.license}`)
    if (manifest.keywords?.length) console.log(`Keywords: ${manifest.keywords.join(', ')}`)
    console.log(`Registry: ${resolved.registry.name} (${resolved.registry.url})`)
    console.log(`Source: ${resolved.sourceLabel}`)
    console.log(`Trust: ${describeTrustTier(trustTier)}`)
    console.log(`Installability: ${resolved.installability}`)
    console.log(`Registry snapshot: ${resolved.registryDocument.signature.signed_digest}`)
    console.log(`Plugin snapshot: ${resolved.snapshotDigest}`)

    if (resolved.lockArtifact.dependencies.length) {
      console.log('')
      console.log('Dependencies:')
      for (const dep of resolved.lockArtifact.dependencies) {
        console.log(`  - ${dep.plugin}@${dep.version}`)
      }
    }

    if (installFiles.length) {
      console.log('')
      console.log('Files:')
    }
    for (const f of installFiles) {
      console.log(`  ${f.path} [${f.digest.slice(0, 15)}...]`)
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
