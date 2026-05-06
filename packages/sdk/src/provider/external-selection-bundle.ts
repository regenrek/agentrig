import { detectArtifactClosure, extractArtifactsFromRepoScan } from './extract-artifacts'
import {
  buildSelectionBundle,
  type SelectionBundle,
  type SelectionInstallScope,
  type SelectionProviderId,
  type SelectionSource,
  type SelectedArtifactForBundle,
} from './selection-bundle'
import type { RepoScanReport } from '../repo-scan/types'
import type { VirtualTree } from '../repo-scan/virtual-tree'

export type ExternalRepoSelectionSource = Extract<SelectionSource, { kind: 'external-repo-scan' }>

export type BuildExternalSelectionBundleInput = {
  tree: VirtualTree
  report: Pick<RepoScanReport, 'digest' | 'signals'>
  selectedSourcePaths: readonly string[]
  provider: SelectionProviderId
  scope: SelectionInstallScope
  source: ExternalRepoSelectionSource
}

export type ExternalSelectionBundleResult = {
  bundle: SelectionBundle
  selectedArtifacts: SelectedArtifactForBundle[]
}

export async function buildExternalSelectionBundle(
  input: BuildExternalSelectionBundleInput
): Promise<ExternalSelectionBundleResult> {
  const selectedSourcePaths = [...new Set(input.selectedSourcePaths.map((path) => path.trim()).filter(Boolean))]
  if (selectedSourcePaths.length === 0) {
    throw new Error('External repo selection requires at least one selected source path.')
  }

  const artifacts = extractArtifactsFromRepoScan({
    digest: input.report.digest,
    signals: input.report.signals,
  })
  const artifactBySourcePath = new Map(artifacts.map((artifact) => [artifact.sourcePath, artifact]))
  const missing = selectedSourcePaths.filter((sourcePath) => !artifactBySourcePath.has(sourcePath))
  if (missing.length) {
    throw new Error(`Selected source path is not an installable artifact: ${missing.join(', ')}`)
  }

  const selectedArtifacts = selectedSourcePaths.map((sourcePath) => {
    const artifact = artifactBySourcePath.get(sourcePath)
    if (!artifact) throw new Error(`Selected source path is not an installable artifact: ${sourcePath}`)
    return artifact
  })
  const selectedSelectors = selectedArtifacts.map((artifact) => artifact.selector)
  const closedArtifacts = await Promise.all(
    selectedArtifacts.map(async (artifact) => {
      const closure = await detectArtifactClosure(input.tree, artifact, {
        selectedSelectors,
      })
      return {
        kind: artifact.kind,
        name: artifact.name,
        selector: artifact.selector,
        sourcePath: artifact.sourcePath,
        fileDigests: artifact.fileDigests,
        dependencies: artifact.dependencies,
        closureStatus: closure.status,
        ...(closure.reason ? { closureReason: closure.reason } : {}),
      } satisfies SelectedArtifactForBundle
    })
  )
  const bundle = await buildSelectionBundle({
    provider: input.provider,
    scope: input.scope,
    source: input.source,
    selectedArtifacts: closedArtifacts,
  })
  return {
    bundle,
    selectedArtifacts: closedArtifacts,
  }
}
