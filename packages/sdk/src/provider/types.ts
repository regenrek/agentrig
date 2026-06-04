import type { ProviderAffinity, ProviderCompat, ProviderCompatState, ProviderId, Signal } from '../repo-scan/types'
import type { VirtualTree } from '../repo-scan/virtual-tree'

export type {
  ProviderAffinity,
  ProviderCompat,
  ProviderCompatState,
  ProviderId,
}

export type PickedSignal = Pick<Signal, 'id' | 'kind' | 'sourcePath' | 'files'>

export type ExternalRepoSource = {
  repoUrl?: string
  owner?: string
  repo?: string
  ref?: string
  commitSha?: string
  subdir?: string
  scanDigest: string
}

export type MaterializedPluginManifestInput = {
  name: string
  displayName?: string
  description: string
  version: string
  category: string
  author?: {
    name: string
    email?: string
    url?: string
  }
  license?: string
  keywords?: string[]
  source: ExternalRepoSource
}

export type MaterializedPluginFile = {
  path: string
  bytes: Uint8Array
}

export type MaterializePluginOptions = {
  tree: VirtualTree
  manifest: MaterializedPluginManifestInput
  pickedSignals: Signal[]
}
