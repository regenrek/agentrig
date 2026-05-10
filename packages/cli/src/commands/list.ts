import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import {
  listPluginInstallRecords,
  listSelectionInstallRecords,
  loadPluginInstallLedgers,
} from '../lib/plugin-install-ledger'
import { selfHealClaudeInstalls } from '../lib/plugin-providers/claude-self-heal'
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
      // Self-heal pre-0.7.4 Claude installs whose marketplace source path
      // points at a now-cleaned `/tmp/agentrig-plugins-*` directory.
      const heal = await selfHealClaudeInstalls(cwd)
      for (const entry of heal.patchedLedgerEntries) {
        console.log(
          `[self-heal] Claude install ${entry.id}: marketplace source ${entry.previousSource} -> ${entry.nextSource}`
        )
      }
      for (const warning of heal.warnings) {
        console.warn(`[self-heal] ${warning}`)
      }

      const ledgers = await loadPluginInstallLedgers(cwd)
      const pluginRecords = listPluginInstallRecords(ledgers).sort((left, right) =>
        `${left.provider}:${left.scope}:${left.pluginId}`.localeCompare(
          `${right.provider}:${right.scope}:${right.pluginId}`
        )
      )
      console.log('Installed plugins:')
      if (!pluginRecords.length) console.log('  (none)')
      for (const record of pluginRecords) {
        console.log(
          `  - ${record.pluginId}@${record.pluginVersion} (${record.provider}, ${record.scope})${formatInstallSource(record.specIdentity)}`
        )
      }
      console.log('')

      const selectionRecords = listSelectionInstallRecords(ledgers).sort((left, right) =>
        `${left.provider}:${left.scope}:${left.pluginId}:${left.selectionId}`.localeCompare(
          `${right.provider}:${right.scope}:${right.pluginId}:${right.selectionId}`
        )
      )
      console.log('Installed skill/mcp/hook selections:')
      if (!selectionRecords.length) console.log('  (none)')
      for (const record of selectionRecords) {
        const kind =
          record.specIdentity.kind === 'registry-artifact'
            ? record.specIdentity.artifactKind
            : 'plugin-selection'
        const selectorList = record.selectedSelectors.join(', ')
        console.log(
          `  - [${kind}] ${record.pluginId}@${record.pluginVersion} (${record.provider}, ${record.scope})${formatInstallSource(record.specIdentity)}`
        )
        if (selectorList) console.log(`      selectors: ${selectorList}`)
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
