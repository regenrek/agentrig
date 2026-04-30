import { digestSignals } from './digest'
import { runTier1Detectors } from './detectors'
import { discoverPluginCandidates, scanPluginCandidatesFromDetected } from './detectors/plugin-roots'
import type { RepoScanReport, RepoScanSource, SignalKind } from './types'
import { listVirtualFiles, type VirtualTree } from './virtual-tree'

export type ScanRepoOptions = {
  source: RepoScanSource
  tree: VirtualTree
}

export async function scanRepo(options: ScanRepoOptions): Promise<RepoScanReport> {
  const [signals, pluginCandidates] = await Promise.all([
    runTier1Detectors(options.tree),
    detectScanPluginCandidates(options.tree),
  ])
  return {
    source: options.source,
    signals,
    pluginCandidates,
    digest: await digestSignals(signals),
  }
}

async function detectScanPluginCandidates(tree: VirtualTree) {
  const files = await listVirtualFiles(tree)
  return scanPluginCandidatesFromDetected(await discoverPluginCandidates({ tree, files }))
}

export function filterSignalsByKind<Signal extends { kind: SignalKind }>(
  signals: readonly Signal[],
  onlyKinds: readonly SignalKind[]
) {
  const allowed = new Set(onlyKinds)
  return signals.filter((signal) => allowed.has(signal.kind))
}
