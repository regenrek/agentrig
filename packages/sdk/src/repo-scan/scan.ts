import { digestSignals } from './digest'
import { runTier1Detectors } from './detectors'
import type { RepoScanReport, RepoScanSource, SignalKind } from './types'
import type { VirtualTree } from './virtual-tree'

export type ScanRepoOptions = {
  source: RepoScanSource
  tree: VirtualTree
}

export async function scanRepo(options: ScanRepoOptions): Promise<RepoScanReport> {
  const signals = await runTier1Detectors(options.tree)
  return {
    source: options.source,
    signals,
    digest: await digestSignals(signals),
  }
}

export function filterSignalsByKind<Signal extends { kind: SignalKind }>(
  signals: readonly Signal[],
  onlyKinds: readonly SignalKind[]
) {
  const allowed = new Set(onlyKinds)
  return signals.filter((signal) => allowed.has(signal.kind))
}
