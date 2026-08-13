import type { ProviderAffinity, ProviderCompat, ProviderCompatState, ProviderId, RepoScanPluginCandidate, Signal } from '../repo-scan/types'
import type { VirtualTree } from '../repo-scan/virtual-tree'

export type {
  ProviderAffinity,
  ProviderCompat,
  ProviderCompatState,
  ProviderId,
}

export type PickedSignal = Pick<Signal, 'id' | 'kind' | 'sourcePath' | 'files'>

export type MaterializedPluginManifestInput = {
  name: string
  displayName?: string
  description: string
  version: string
  author?: {
    name: string
    email?: string
    url?: string
  }
  license?: string
  keywords?: string[]
}

export type MaterializedPluginFile = {
  path: string
  bytes: Uint8Array
}

export type MaterializePluginOptions = {
  tree: VirtualTree
  manifest: MaterializedPluginManifestInput
  pickedSignals: Signal[]
  sourcePackage?: RepoScanPluginCandidate
}
