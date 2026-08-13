import { formatArtifactSelector, parseArtifactSelector, type SelectableArtifactKind } from './artifact-kinds'
import type { ArtifactClosureStatus, ExtractedArtifact } from './extract-artifacts'

export type SelectionProviderId = 'claude' | 'codex' | 'cursor'
export type SelectionInstallScope = 'personal' | 'workspace'

export type SelectionSource =
  | {
      kind: 'registry-plugin'
      registryAlias: string
      registryUrl: string
      registryRef: string
      artifactId: string
      version: string
      snapshotDigest: string
    }
  | {
      kind: 'registry-artifact'
      registryAlias: string
      registryUrl: string
      registryRef: string
      artifactKind: SelectableArtifactKind | 'plugin'
      artifactId: string
      version: string
      snapshotDigest: string
    }
  | {
      kind: 'external-repo-scan'
      sourceLabel: string
      repoUrl?: string
      owner?: string
      repo?: string
      ref?: string
      commitSha?: string
      subdir?: string
      scanDigest: string
    }

export type SelectedArtifactForBundle = Pick<
  ExtractedArtifact,
  'kind' | 'name' | 'selector' | 'sourcePath' | 'fileDigests' | 'dependencies'
> & {
  closureStatus: ArtifactClosureStatus
  closureReason?: string
  packagePayload?: Array<{
    sourcePath: string
    packagePath: string
    digest: string
  }>
}

export type SelectionJsonWrite = {
  artifactSelector: string
  path: string
  keyPath: string
  sourcePath: string
  sourceDigest: string
  compileMcp?: {
    pluginRoot: string
    pluginData: string
  }
}

export type SelectionFileCopy = {
  artifactSelector: string
  sourcePath: string
  targetPath: string
  digest: string
}

export type SelectionSkippedArtifact = {
  artifactSelector: string
  reason: string
}

export type SelectionProviderMaterialization = {
  fileCopies: SelectionFileCopy[]
  jsonWrites: SelectionJsonWrite[]
  skipped: SelectionSkippedArtifact[]
  warnings: string[]
}

export type SelectionBundle = {
  schemaVersion: 1
  selectionId: string
  provider: SelectionProviderId
  scope: SelectionInstallScope
  source: SelectionSource
  selectedArtifacts: SelectedArtifactForBundle[]
  targetPaths: string[]
  materialization: SelectionProviderMaterialization
}

export type BuildSelectionBundleInput = {
  provider: SelectionProviderId
  scope: SelectionInstallScope
  source: SelectionSource
  selectedArtifacts: SelectedArtifactForBundle[]
}

export async function buildSelectionBundle(input: BuildSelectionBundleInput): Promise<SelectionBundle> {
  if (input.selectedArtifacts.length === 0) {
    throw new Error('Selection Bundle requires at least one selected artifact.')
  }
  const selectedArtifacts = dedupeArtifacts(input.selectedArtifacts)
  const selectionId = await selectionIdFor(input.provider, input.scope, input.source, selectedArtifacts)
  const materialization = buildProviderMaterialization(input.provider, selectedArtifacts, selectionId)
  return {
    schemaVersion: 1,
    selectionId,
    provider: input.provider,
    scope: input.scope,
    source: input.source,
    selectedArtifacts,
    targetPaths: materializationTargets(materialization),
    materialization,
  }
}

export function assertSelectionBundleInstallable(bundle: SelectionBundle): void {
  const blocked = bundle.selectedArtifacts.filter((artifact) => artifact.closureStatus !== 'closed')
  if (blocked.length) {
    throw new Error(`Selection Bundle is not closed: ${blocked.map((artifact) => artifact.selector).join(', ')}`)
  }
  if (bundle.materialization.fileCopies.length === 0 && bundle.materialization.jsonWrites.length === 0) {
    throw new Error('Selection Bundle has no provider-supported materialization targets.')
  }
}

export function buildProviderMaterialization(
  provider: SelectionProviderId,
  selectedArtifacts: readonly SelectedArtifactForBundle[],
  selectionId = 'unidentified-selection',
): SelectionProviderMaterialization {
  const fileCopies: SelectionFileCopy[] = []
  const jsonWrites: SelectionJsonWrite[] = []
  const skipped: SelectionSkippedArtifact[] = []
  const warnings: string[] = []

  for (const artifact of selectedArtifacts) {
    if (artifact.kind === 'mcp') {
      const privateRoot = `.agentrig/selections/${selectionId.replace(/^sha256:/, '')}/plugins/${artifact.name}`
      const privateData = `.agentrig/selections/${selectionId.replace(/^sha256:/, '')}/data/${artifact.name}`
      for (const file of artifact.packagePayload ?? defaultMcpPayload(artifact)) {
        fileCopies.push({
          artifactSelector: artifact.selector,
          sourcePath: file.sourcePath,
          targetPath: `${privateRoot}/${file.packagePath}`,
          digest: file.digest,
        })
      }
      jsonWrites.push({
        artifactSelector: artifact.selector,
        path: provider === 'cursor' ? 'mcp.json' : '.mcp.json',
        keyPath: 'mcpServers',
        sourcePath: artifact.sourcePath,
        sourceDigest: digestForArtifact(artifact),
        compileMcp: {
          pluginRoot: privateRoot,
          pluginData: privateData,
        },
      })
      continue
    }

    if (artifact.kind === 'hook') {
      if (provider === 'claude') {
        jsonWrites.push({
          artifactSelector: artifact.selector,
          path: 'hooks.json',
          keyPath: '$',
          sourcePath: artifact.sourcePath,
          sourceDigest: digestForArtifact(artifact),
        })
        addFileCopies(fileCopies, artifact, 'hooks')
      } else if (provider === 'codex') {
        addFileCopies(fileCopies, artifact, 'hooks')
      } else {
        addFileCopies(fileCopies, artifact, '.cursor/hooks')
      }
      continue
    }

    if (artifact.kind === 'skill') {
      addFileCopies(fileCopies, artifact, provider === 'cursor' ? `.cursor/skills/${artifact.name}` : `skills/${artifact.name}`)
      continue
    }

    if (artifact.kind === 'command') {
      if (provider === 'codex') {
        skipped.push({ artifactSelector: artifact.selector, reason: 'Codex command install is not supported.' })
        warnings.push(`${artifact.selector} skipped for codex.`)
      } else {
        addFileCopies(fileCopies, artifact, provider === 'cursor' ? '.cursor/commands' : 'commands')
      }
      continue
    }

    if (artifact.kind === 'agent') {
      if (provider === 'codex') {
        skipped.push({ artifactSelector: artifact.selector, reason: 'Codex agent install is not supported.' })
        warnings.push(`${artifact.selector} skipped for codex.`)
      } else {
        addFileCopies(fileCopies, artifact, provider === 'cursor' ? '.cursor/agents' : 'agents')
      }
    }
  }

  return {
    fileCopies: fileCopies.sort((left, right) => left.targetPath.localeCompare(right.targetPath)),
    jsonWrites: jsonWrites.sort((left, right) => `${left.path}:${left.keyPath}`.localeCompare(`${right.path}:${right.keyPath}`)),
    skipped: skipped.sort((left, right) => left.artifactSelector.localeCompare(right.artifactSelector)),
    warnings: warnings.sort(),
  }
}

function defaultMcpPayload(artifact: SelectedArtifactForBundle) {
  return artifact.fileDigests.map((file) => ({
    sourcePath: file.path,
    packagePath: relativeArtifactPath(file.path, artifact.sourcePath),
    digest: file.digest,
  }))
}

function relativeArtifactPath(filePath: string, sourcePath: string) {
  if (filePath === sourcePath) return filePath.split('/').pop() ?? filePath
  return filePath.startsWith(`${sourcePath}/`) ? filePath.slice(sourcePath.length + 1) : filePath
}

export function normalizeSelectionPick(input: string, defaultKind?: SelectableArtifactKind) {
  return parseArtifactSelector(input, defaultKind).selector
}

function dedupeArtifacts(artifacts: readonly SelectedArtifactForBundle[]) {
  const bySelector = new Map<string, SelectedArtifactForBundle>()
  for (const artifact of artifacts) {
    const selector = formatArtifactSelector(artifact.kind, artifact.name)
    bySelector.set(selector, { ...artifact, selector })
  }
  return [...bySelector.values()].sort((left, right) => left.selector.localeCompare(right.selector))
}

function addFileCopies(fileCopies: SelectionFileCopy[], artifact: SelectedArtifactForBundle, targetRoot: string) {
  for (const file of artifact.fileDigests) {
    fileCopies.push({
      artifactSelector: artifact.selector,
      sourcePath: file.path,
      targetPath: targetPathFor(file.path, artifact.sourcePath, targetRoot),
      digest: file.digest,
    })
  }
}

function targetPathFor(filePath: string, sourcePath: string, targetRoot: string) {
  const relative = filePath === sourcePath
    ? filePath.split('/').pop() ?? filePath
    : filePath.startsWith(`${sourcePath}/`)
      ? filePath.slice(sourcePath.length + 1)
      : filePath.split('/').pop() ?? filePath
  return `${targetRoot}/${relative}`.replace(/\/+/g, '/')
}

function materializationTargets(materialization: SelectionProviderMaterialization) {
  return [
    ...materialization.fileCopies.map((copy) => copy.targetPath),
    ...materialization.jsonWrites.map((write) => write.path),
  ].sort()
}

function digestForArtifact(artifact: SelectedArtifactForBundle) {
  const first = [...artifact.fileDigests].sort((left, right) => left.path.localeCompare(right.path))[0]
  if (!first) throw new Error(`Artifact has no files: ${artifact.selector}`)
  return first.digest
}

async function selectionIdFor(
  provider: SelectionProviderId,
  scope: SelectionInstallScope,
  source: SelectionSource,
  artifacts: readonly SelectedArtifactForBundle[]
) {
  const payload = JSON.stringify({
    provider,
    scope,
    source: sourceIdentity(source),
    selectors: artifacts.map((artifact) => artifact.selector).sort(),
  })
  return `sha256:${await sha256Hex(new TextEncoder().encode(payload))}`
}

function sourceIdentity(source: SelectionSource) {
  if (source.kind === 'external-repo-scan') {
    return {
      kind: source.kind,
      sourceLabel: source.sourceLabel,
      repoUrl: source.repoUrl,
      ref: source.ref,
      commitSha: source.commitSha,
      subdir: source.subdir,
      scanDigest: source.scanDigest,
    }
  }
  const registryIdentity = {
    kind: source.kind,
    registryAlias: source.registryAlias,
    registryUrl: source.registryUrl,
    registryRef: source.registryRef,
    artifactId: source.artifactId,
    version: source.version,
    snapshotDigest: source.snapshotDigest,
  }
  if (source.kind === 'registry-artifact') {
    return {
      ...registryIdentity,
      artifactKind: source.artifactKind,
    }
  }
  return registryIdentity
}

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
