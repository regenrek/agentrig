import type { Signal, SignalKind } from '../types'
import { normalizeVirtualPath } from '../virtual-tree'
import {
  createSignal,
  filesForExact,
  idFromPath,
  titleFromPath,
  type DetectorInput,
} from './common'

const DOC_FILENAMES = new Set(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md'])
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])
const ASSET_PREFIXES = ['assets/', 'images/', 'media/']
const SCRIPT_PREFIXES = ['scripts/', 'bin/']

export function detectPathSignals(input: DetectorInput): Signal[] {
  const signals: Signal[] = []
  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    if (isOwnedByStructuredDetector(path)) continue

    if (path.startsWith('agents/') && isMarkdown(path)) {
      signals.push(pathSignal(input, path, 'agent', 0.7))
      continue
    }
    if (SCRIPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      signals.push(pathSignal(input, path, 'script', 0.55))
      continue
    }
    if (ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      signals.push(pathSignal(input, path, 'asset', 0.5))
      continue
    }
    if (isDocPath(path)) {
      signals.push(pathSignal(input, path, 'doc', 0.45))
    }
  }
  return collapseDirectorySignals(signals)
}

function pathSignal(input: DetectorInput, path: string, kind: SignalKind, score: number) {
  return createSignal({
    kind,
    id: idFromPath(path),
    title: titleFromPath(path),
    sourcePath: path,
    files: filesForExact(input.files, path),
    score,
  })
}

function collapseDirectorySignals(signals: Signal[]) {
  const groupedAssets = collapsePrefix(signals, 'asset', 'assets')
  const groupedScripts = collapsePrefix(groupedAssets, 'script', 'scripts')
  return groupedScripts.sort(signalSort)
}

function collapsePrefix(signals: Signal[], kind: SignalKind, prefix: string) {
  const matching = signals.filter((signal) => signal.kind === kind && signal.sourcePath.startsWith(`${prefix}/`))
  if (matching.length <= 1) return signals

  const rest = signals.filter((signal) => !matching.includes(signal))
  const first = matching[0]
  return [
    ...rest,
    createSignal({
      kind,
      id: prefix,
      title: titleFromPath(prefix),
      sourcePath: prefix,
      files: matching.flatMap((signal) => signal.files),
      score: first.score,
    }),
  ]
}

function signalSort(left: Signal, right: Signal) {
  return `${left.sourcePath}:${left.kind}:${left.id}`.localeCompare(`${right.sourcePath}:${right.kind}:${right.id}`)
}

function isOwnedByStructuredDetector(path: string) {
  return (
    path.endsWith('/SKILL.md') ||
    path.startsWith('.cursor/rules/') ||
    path.startsWith('.claude/commands/') ||
    path.startsWith('.codex/prompts/') ||
    path.startsWith('.cursor/commands/') ||
    path === '.mcp.json' ||
    path === 'mcp.json' ||
    path === 'hooks.json' ||
    path.endsWith('/hooks.json') ||
    path === '.lsp.json' ||
    path === '.app.json' ||
    path === 'settings.json' ||
    path.startsWith('commands/') ||
    path.startsWith('prompts/')
  )
}

function isDocPath(path: string) {
  if (DOC_FILENAMES.has(path)) return true
  if (!path.startsWith('docs/')) return false
  return [...DOC_EXTENSIONS].some((extension) => path.endsWith(extension))
}

function isMarkdown(path: string) {
  return path.endsWith('.md') || path.endsWith('.mdx')
}
