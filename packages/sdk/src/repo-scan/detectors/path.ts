import type { Signal, SignalKind } from '../types'
import { normalizeVirtualPath } from '../virtual-tree'
import {
  createSignal,
  detectorRoots,
  filesForExact,
  idFromPath,
  relativePathFromRoot,
  titleFromPath,
  type DetectorInput,
} from './common'

const DOC_FILENAMES = new Set(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md'])
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])
const ASSET_PREFIXES = ['assets/', 'images/', 'media/']
const SCRIPT_PREFIXES = ['scripts/', 'bin/']

export function detectPathSignals(input: DetectorInput): Signal[] {
  const signals: Signal[] = []
  const skillRoots = detectSkillRoots(input.files.map((file) => normalizeVirtualPath(file.path)))
  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    if (isWithinSkillRoot(path, skillRoots)) continue

    for (const root of detectorRoots(input)) {
      const relativePath = relativePathFromRoot(path, root)
      if (!relativePath || isOwnedByStructuredDetector(relativePath)) continue

      if (SCRIPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
        signals.push(pathSignal(input, path, 'script', 0.55))
        break
      }
      if (ASSET_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
        signals.push(pathSignal(input, path, 'asset', 0.5))
        break
      }
      if (isDocPath(relativePath)) {
        signals.push(pathSignal(input, path, 'doc', 0.45))
        break
      }
    }
  }
  return collapseDirectorySignals(input, signals)
}

function detectSkillRoots(paths: readonly string[]) {
  return paths
    .filter((path) => path.endsWith('/SKILL.md') || path === 'SKILL.md')
    .map((path) => path.replace(/(^|\/)SKILL\.md$/i, '').replace(/\/+$/g, ''))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
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

function collapseDirectorySignals(input: DetectorInput, signals: Signal[]) {
  let groupedSignals = signals
  for (const root of detectorRoots(input)) {
    groupedSignals = collapsePrefix(groupedSignals, 'asset', root ? `${root}/assets` : 'assets')
    groupedSignals = collapsePrefix(groupedSignals, 'script', root ? `${root}/scripts` : 'scripts')
  }
  const groupedScripts = groupedSignals
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
    path.startsWith('prompts/') ||
    path.startsWith('agents/')
  )
}

function isWithinSkillRoot(path: string, skillRoots: readonly string[]) {
  return skillRoots.some((root) => path !== `${root}/SKILL.md` && path.startsWith(`${root}/`))
}

function isDocPath(path: string) {
  if (DOC_FILENAMES.has(path)) return true
  if (!path.startsWith('docs/')) return false
  return [...DOC_EXTENSIONS].some((extension) => path.endsWith(extension))
}

