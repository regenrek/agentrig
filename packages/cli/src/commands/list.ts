import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadPluginInstallLedgers, listPluginInstallRecords } from '../lib/plugin-install-ledger'
import type { PluginInstallSpecIdentity } from '../lib/types'

const args = {
  cwd: {
    type: 'string',
    description: 'Working directory (defaults to current directory)',
  },
  installed: {
    type: 'boolean',
    description: 'List installed plugins (default)',
    default: true,
  },
  available: {
    type: 'boolean',
    description: 'List plugins available in registries',
    default: false,
  },
  registry: {
    type: 'string',
    description: 'Registry alias (from config)',
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
    name: 'list',
    description: 'List installed plugins and/or available plugins in registries.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()

    if (args.installed) {
      const ledgers = await loadPluginInstallLedgers(cwd)
      const records = listPluginInstallRecords(ledgers).sort((left, right) =>
        `${left.provider}:${left.scope}:${left.pluginId}`.localeCompare(
          `${right.provider}:${right.scope}:${right.pluginId}`
        )
      )
      console.log('Installed plugins:')
      if (!records.length) console.log('  (none)')
      for (const record of records) {
        console.log(
          `  - ${record.pluginId}@${record.pluginVersion} (${record.provider}, ${record.scope})${formatInstallSource(record.specIdentity)}`
        )
      }
      console.log('')
    }

    if (!args.available) return

    console.log('Available marketplace listing browse is no longer served from local registry indexes.')
    console.log('Use `agentrig search` for discovery, then install by canonical namespace.artifact token.')
  },
})

function formatInstallSource(identity: PluginInstallSpecIdentity) {
  if (identity.kind !== 'external-repo') return ''
  const repo = identity.repoUrl || [identity.owner, identity.repo].filter(Boolean).join('/') || 'external repo'
  const revision = identity.commitSha || identity.ref || identity.scanDigest.slice(0, 12)
  return ` from ${repo}@${revision}`
}

export default command
