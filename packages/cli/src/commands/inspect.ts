import { defineCommand, showUsage } from 'citty'
import { filterSignalsByKind, scanRepo, SIGNAL_KINDS, type SignalKind } from '@agentrig/sdk'
import { resolveRepoSource } from '../lib/repo-source'

const command = defineCommand({
  meta: {
    name: 'inspect',
    description: 'Scan an agent repo and report reusable AgentRig signals.',
  },
  args: {
    source: {
      type: 'positional',
      description: 'Local path, GitHub owner/repo, github:owner/repo, or GitHub URL',
      required: true,
    },
    ref: {
      type: 'string',
      description: 'Git ref for remote sources',
    },
    path: {
      type: 'string',
      description: 'Subdirectory to scan within the source',
    },
    'only-kind': {
      type: 'string',
      description: 'Comma-separated signal kinds to display',
    },
    json: {
      type: 'boolean',
      description: 'Print JSON',
      default: false,
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const resolved = await resolveRepoSource({
      source: String(args.source),
      ref: args.ref ? String(args.ref) : undefined,
      subdir: args.path ? String(args.path) : undefined,
    })
    try {
      const report = await scanRepo({ source: resolved.source, tree: resolved.tree })
      const onlyKind = args['only-kind']
      const onlyKinds = onlyKind ? parseKinds(String(onlyKind)) : undefined
      const signals = onlyKinds ? filterSignalsByKind(report.signals, onlyKinds) : report.signals

      if (args.json) {
        console.log(JSON.stringify({ ...report, signals }, null, 2))
        return
      }

      console.log(`Source: ${report.source.label}`)
      console.log(`Digest: ${report.digest}`)
      console.log(`Signals: ${signals.length}${signals.length !== report.signals.length ? `/${report.signals.length}` : ''}`)
      for (const signal of signals) {
        const providers = Object.entries(signal.providerCompat)
          .filter(([, compat]) => compat !== 'unsupported')
          .map(([provider, compat]) => `${provider}:${compat}`)
          .join(', ')
        console.log(`- ${signal.kind} ${signal.sourcePath} (${providers || 'unsupported'})`)
      }
    } finally {
      await resolved.cleanup()
    }
  },
})

function parseKinds(value: string): SignalKind[] {
  const kinds = value.split(',').map((item) => item.trim()).filter(Boolean)
  const invalid = kinds.find((kind) => !(SIGNAL_KINDS as readonly string[]).includes(kind))
  if (invalid) {
    throw new Error(`Invalid signal kind: ${invalid}`)
  }
  return kinds as SignalKind[]
}

export default command
