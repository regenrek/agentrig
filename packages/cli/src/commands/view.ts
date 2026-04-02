import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadConfig } from '../lib/config'
import { resolvePluginSpec } from '../lib/plugin-resolver'
import { determineTrustTier, describeTrustTier, validatePluginPaths } from '../lib/trust'

const args = {
  spec: {
    type: 'positional',
    description: 'Plugin id, registryAlias/plugin, or a .plugin/plugin.json URL/path',
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
    const installFiles = resolved.installMetadata?.files ?? []
    const trustTier = resolved.trustTier ?? await determineTrustTier(
      resolveTrustSource(spec, resolved),
      cfg.registries
    )

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
        source: resolved.sourceLabel,
        trustTier,
        files: installFiles,
        pluginDependencies: manifest.pluginDependencies,
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
    console.log(`Source: ${resolved.sourceLabel}`)
    console.log(`Trust: ${describeTrustTier(trustTier)}`)

    if (manifest.pluginDependencies?.length) {
      console.log('')
      console.log('Dependencies:')
      for (const dep of manifest.pluginDependencies) {
        console.log(`  - ${dep}`)
      }
    }

    if (installFiles.length) {
      console.log('')
      console.log('Files:')
    }
    for (const f of installFiles) {
      const mode = f.mode ? ` (mode: ${f.mode})` : ''
      const hash = f.sha256 ? ` [${f.sha256.slice(0, 8)}...]` : ''
      console.log(`  ${f.path}${mode}${hash}`)
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
