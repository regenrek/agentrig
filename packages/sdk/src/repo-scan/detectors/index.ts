import type { Signal } from '../types'
import { listVirtualFiles, sortVirtualPaths, type VirtualTree } from '../virtual-tree'
import { detectCursorRules, detectJsonConfigs, detectSkills, detectTopLevelPrompts, detectTypedCommands } from './content'
import { detectPathSignals } from './path'
import type { DetectorInput, SignalDetector } from './common'

export const TIER1_DETECTORS: readonly SignalDetector[] = [
  detectSkills,
  detectJsonConfigs,
  detectCursorRules,
  detectTypedCommands,
  detectTopLevelPrompts,
  detectPathSignals,
]

export async function runTier1Detectors(tree: VirtualTree, detectors = TIER1_DETECTORS) {
  const input: DetectorInput = {
    tree,
    files: await listVirtualFiles(tree),
  }
  const detected = await Promise.all(detectors.map((detector) => detector(input)))
  return sortSignals(deduplicateSignals(detected.flat()))
}

export function sortSignals(signals: readonly Signal[]) {
  return [...signals].sort((left, right) =>
    `${left.sourcePath}:${left.kind}:${left.id}`.localeCompare(`${right.sourcePath}:${right.kind}:${right.id}`)
  )
}

function deduplicateSignals(signals: Signal[]) {
  const seen = new Set<string>()
  const unique: Signal[] = []
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.sourcePath}:${signal.id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({
      ...signal,
      files: sortVirtualPaths(signal.files),
    })
  }
  return unique
}
