import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  assertSelectionBundleInstallable,
  buildSelectionBundle,
  detectArtifactClosure,
  extractArtifactsFromPluginLock,
  formatArtifactSelector,
  normalizeSelectionPick,
  type ExtractedArtifact,
  type InstallBundle,
  type SelectableArtifactKind,
  type SelectionBundle,
  type SelectionProviderId,
  type SelectedArtifactForBundle,
  type VirtualTree,
} from '@agentrig/sdk'
import { createLocalFsVirtualTree } from '@agentrig/sdk/fs-adapters/local-fs'
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from './fs'
import { sha256Hex } from './hash'
import { getAgentRigHome } from './paths'
import {
  getResolvedPluginSpecIdentity,
  getResolvedRegistryArtifactSpecIdentity,
  getResolvedVerifiedRegistryIdentity,
  isSamePluginInstallSpecIdentity,
  resolvePluginInstallSpecIdentity,
  resolveRegistryArtifactInstallSpecIdentity,
} from './plugin-install-spec'
import type { ParsedRegistryArtifactKind } from './registry-spec'
import { installBundleSnapshotDigest } from './registry'
import {
  createProviderJsonWrite,
  formatKeptModifiedJsonWrite,
} from './plugin-providers/json-ownership'
import {
  listSelectionInstallRecords,
  loadPluginInstallLedgers,
  removeSelectionInstallRecords,
  upsertSelectionInstallRecords,
} from './plugin-install-ledger'
import type {
  PluginInstallScopeName,
  PluginInstallScopeSelectorName,
  PluginInstallSpecIdentity,
  PluginInstalledFile,
  PluginJsonWrite,
  SelectionInstallRecord,
} from './types'
import type { RegistryRef } from '@agentrig/sdk'

export type RegistryPluginSelectionInstallInput = {
  sourceKind?: 'registry-plugin'
  cwd: string
  provider: SelectionProviderId
  requestedScope: PluginInstallScopeSelectorName
  scope: PluginInstallScopeName
  registryRef: string
  resolved: InstallBundle
  pluginDir: string
  picks: string[]
  defaultKind?: SelectableArtifactKind
  force?: boolean
  dryRun?: boolean
}

export type RegistryArtifactSelectionInstallInput = {
  sourceKind: 'registry-artifact'
  cwd: string
  provider: SelectionProviderId
  requestedScope: PluginInstallScopeSelectorName
  scope: PluginInstallScopeName
  registryRef: string
  resolved: InstallBundle
  pluginDir: string
  picks?: string[]
  force?: boolean
  dryRun?: boolean
}

export type ArtifactSelectionInstallInput = RegistryPluginSelectionInstallInput | RegistryArtifactSelectionInstallInput

export type ArtifactSelectionInstallResult = {
  bundle: SelectionBundle
  record: SelectionInstallRecord
  installedFiles: PluginInstalledFile[]
  jsonWrites: PluginJsonWrite[]
  rootDir: string
}

export type ExternalRepoSelectionInstallInput = {
  sourceKind: 'external-repo-scan'
  cwd: string
  provider: SelectionProviderId
  requestedScope: PluginInstallScopeSelectorName
  scope: PluginInstallScopeName
  tree: VirtualTree
  bundle: SelectionBundle
  specIdentity: PluginInstallSpecIdentity
  pluginId: string
  pluginVersion: string
  snapshotDigest: string
  force?: boolean
  dryRun?: boolean
}

export type ArtifactSelectionUninstallInput = {
  sourceKind?: 'registry-plugin' | 'registry-artifact'
  cwd: string
  provider: SelectionProviderId
  source: string
  registries: RegistryRef[]
  picks: string[]
  defaultKind?: SelectableArtifactKind
  scope?: PluginInstallScopeName
  dryRun?: boolean
}

export type ArtifactSelectionUninstallResult = {
  removed: string[]
  kept: string[]
  missing: string[]
  clearedRecordIds: string[]
}

export async function installArtifactSelection(input: ArtifactSelectionInstallInput): Promise<ArtifactSelectionInstallResult> {
  if (input.sourceKind !== 'registry-artifact' && input.picks.length === 0) {
    throw new Error('Selection install requires at least one --pick value.')
  }
  if (input.sourceKind === 'registry-artifact' && (input.picks?.length ?? 0) > 0) {
    throw new Error('Standalone registry artifact install does not accept --pick values.')
  }

  const artifacts = input.sourceKind === 'registry-artifact'
    ? [artifactFromStandaloneRegistryArtifact(input.resolved)]
    : extractArtifactsFromPluginLock(lockFromInstallBundle(input.resolved))
  const selectedSelectors = input.sourceKind === 'registry-artifact'
    ? artifacts.map((artifact) => artifact.selector)
    : input.picks.map((pick) => normalizeSelectionPick(pick, input.defaultKind))
  const selectedArtifacts = input.sourceKind === 'registry-artifact'
    ? artifacts.map((artifact) => ({
      ...artifact,
      closureStatus: 'closed' as const,
    }))
    : await resolveSelectedArtifacts(input.pluginDir, artifacts, selectedSelectors)
  const bundle = await buildSelectionBundle({
    provider: input.provider,
    scope: input.scope,
    source: selectionSourceForInstall(input),
    selectedArtifacts,
  })
  assertSelectionBundleInstallable(bundle)

  const rootDir = resolveSelectionRoot(input.cwd, input.provider, input.scope)
  const source = { kind: 'local-dir' as const, pluginDir: input.pluginDir }
  const installedFiles = await installSelectionFiles(source, rootDir, bundle, Boolean(input.force), Boolean(input.dryRun))
  const jsonWrites = await installSelectionJson(source, rootDir, bundle, bundle.selectedArtifacts, Boolean(input.force), Boolean(input.dryRun))

  const record: SelectionInstallRecord = {
    id: `selection:${input.provider}:${input.scope}:${bundle.selectionId}`,
    provider: input.provider,
    requestedScope: input.requestedScope,
    specIdentity: input.sourceKind === 'registry-artifact'
      ? getResolvedRegistryArtifactSpecIdentity(input.resolved)
      : getResolvedPluginSpecIdentity(input.resolved),
    registry: getResolvedVerifiedRegistryIdentity(input.resolved),
    scope: input.scope,
    pluginId: input.resolved.listing.artifactId,
    pluginVersion: input.resolved.listing.version,
    snapshotDigest: installBundleSnapshotDigest(input.resolved),
    selectionId: bundle.selectionId,
    selectedSelectors: bundle.selectedArtifacts.map((artifact) => artifact.selector),
    targetPaths: bundle.targetPaths.map((targetPath) => resolveTargetPath(rootDir, targetPath)),
    installedAt: new Date().toISOString(),
    files: installedFiles,
    jsonWrites,
  }

  if (!input.dryRun) {
    await upsertSelectionInstallRecords(input.cwd, input.scope, [record])
  }

  return {
    bundle,
    record,
    installedFiles,
    jsonWrites,
    rootDir,
  }
}

export async function installExternalRepoSelection(
  input: ExternalRepoSelectionInstallInput
): Promise<ArtifactSelectionInstallResult> {
  if (input.bundle.source.kind !== 'external-repo-scan') {
    throw new Error('External repo selection install requires an external-repo-scan Selection Bundle.')
  }
  assertSelectionBundleInstallable(input.bundle)

  const rootDir = resolveSelectionRoot(input.cwd, input.provider, input.scope)
  const source = { kind: 'tree' as const, tree: input.tree }
  const installedFiles = await installSelectionFiles(source, rootDir, input.bundle, Boolean(input.force), Boolean(input.dryRun))
  const jsonWrites = await installSelectionJson(source, rootDir, input.bundle, input.bundle.selectedArtifacts, Boolean(input.force), Boolean(input.dryRun))
  const record: SelectionInstallRecord = {
    id: `selection:${input.provider}:${input.scope}:${input.bundle.selectionId}`,
    provider: input.provider,
    requestedScope: input.requestedScope,
    specIdentity: input.specIdentity,
    scope: input.scope,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    snapshotDigest: input.snapshotDigest,
    selectionId: input.bundle.selectionId,
    selectedSelectors: input.bundle.selectedArtifacts.map((artifact) => artifact.selector),
    targetPaths: input.bundle.targetPaths.map((targetPath) => resolveTargetPath(rootDir, targetPath)),
    installedAt: new Date().toISOString(),
    files: installedFiles,
    jsonWrites,
  }

  if (!input.dryRun) {
    await upsertSelectionInstallRecords(input.cwd, input.scope, [record])
  }

  return {
    bundle: input.bundle,
    record,
    installedFiles,
    jsonWrites,
    rootDir,
  }
}

function selectionSourceForInstall(input: ArtifactSelectionInstallInput) {
  if (input.sourceKind === 'registry-artifact') {
    return {
      kind: 'registry-artifact' as const,
      registryAlias: input.resolved.listing.registryAlias ?? 'agentrig',
      registryUrl: input.resolved.source.url ?? 'https://agentrig.ai',
      registryRef: `${input.resolved.listing.registryAlias ?? 'agentrig'}/${input.resolved.listing.slug ?? input.resolved.listing.artifactId}@${input.resolved.listing.version}`,
      artifactKind: input.resolved.listing.kind,
      artifactId: input.resolved.listing.artifactId,
      version: input.resolved.listing.version,
      snapshotDigest: installBundleSnapshotDigest(input.resolved),
    }
  }
  return {
    kind: 'registry-plugin' as const,
    registryAlias: input.resolved.listing.registryAlias ?? 'agentrig',
    registryUrl: input.resolved.source.url ?? 'https://agentrig.ai',
    registryRef: `${input.resolved.listing.registryAlias ?? 'agentrig'}/${input.resolved.listing.slug ?? input.resolved.listing.artifactId}@${input.resolved.listing.version}`,
    artifactId: input.resolved.listing.artifactId,
    version: input.resolved.listing.version,
    snapshotDigest: installBundleSnapshotDigest(input.resolved),
  }
}

function artifactFromStandaloneRegistryArtifact(resolved: InstallBundle): ExtractedArtifact {
  const sourcePath = standaloneArtifactSourcePath(resolved)
  const name = sourcePath === '.'
    ? (resolved.listing.slug ?? resolved.listing.artifactId).split(/[/.]/).pop() ?? resolved.listing.artifactId
    : sourcePath.split('/').pop() ?? resolved.listing.artifactId
  const selector = formatArtifactSelector(resolved.listing.kind as ExtractedArtifact['kind'], name)
  const fileDigests = resolved.file_list.map((file) => ({
    path: file.path,
    digest: file.sha256,
    bytes: file.size,
  }))
  return {
    kind: resolved.listing.kind as ExtractedArtifact['kind'],
    origin: 'standalone',
    name,
    artifactId: resolved.listing.artifactId,
    selector,
    sourcePath,
    paths: fileDigests.map((file) => file.path),
    fileDigests,
    dependencies: [],
    capabilitySet: [],
    declaredNetworkDomains: [],
    declaredSecrets: [],
    runtimeRequirements: [],
  }
}

function lockFromInstallBundle(bundle: InstallBundle) {
  return {
    plugin: bundle.listing.artifactId,
    version: bundle.listing.version,
    file_digests: bundle.file_list.map((file) => ({
      path: file.path,
      digest: file.sha256,
      bytes: file.size,
    })),
    capability_set: [],
    declared_network_domains: [],
    declared_secrets: [],
    runtime_requirements: [],
    dependencies: [],
    snapshot_digest: installBundleSnapshotDigest(bundle),
  }
}

function standaloneArtifactSourcePath(bundle: InstallBundle) {
  const firstPath = bundle.file_list[0]?.path
  if (!firstPath) return '.'
  const segments = firstPath.split('/')
  if (segments.length > 2 && ['skills', 'mcps', 'hooks'].includes(segments[0]!)) {
    return segments.slice(0, 2).join('/')
  }
  return '.'
}

async function resolveSelectedArtifacts(pluginDir: string, artifacts: ExtractedArtifact[], selectedSelectors: string[]) {
  const bySelector = new Map(artifacts.map((artifact) => [artifact.selector, artifact]))
  const missing = selectedSelectors.filter((selector) => !bySelector.has(selector))
  if (missing.length) {
    throw new Error(`Selected artifact not found in plugin lock: ${missing.join(', ')}`)
  }

  const selectedSet = new Set(selectedSelectors)
  const tree = createLocalFsVirtualTree(pluginDir)
  return Promise.all(
    selectedSelectors.map(async (selector) => {
      const artifact = bySelector.get(selector)
      if (!artifact) throw new Error(`Selected artifact not found in plugin lock: ${selector}`)
      const closure = await detectArtifactClosure(tree, artifact, {
        selectedSelectors: [...selectedSet],
      })
      return {
        ...artifact,
        closureStatus: closure.status,
        closureReason: closure.reason,
      }
    })
  )
}

function resolveSelectionRoot(cwd: string, provider: SelectionProviderId, scope: PluginInstallScopeName) {
  if (provider === 'claude') {
    return scope === 'workspace' ? path.join(cwd, '.claude') : path.join(getAgentRigHome(), '.claude')
  }
  if (provider === 'codex') {
    return scope === 'workspace' ? path.join(cwd, '.codex') : path.join(getAgentRigHome(), '.codex')
  }
  return scope === 'workspace' ? cwd : getAgentRigHome()
}

async function installSelectionFiles(
  source: SelectionFileSource,
  rootDir: string,
  bundle: SelectionBundle,
  force: boolean,
  dryRun: boolean
) {
  const installedFiles: PluginInstalledFile[] = []
  for (const copy of bundle.materialization.fileCopies) {
    const targetPath = resolveTargetPath(rootDir, copy.targetPath)
    const bytes = await readSourceBytes(source, copy.sourcePath)
    const actualDigest = `sha256:${sha256Hex(bytes)}`
    const expectedDigest = normalizeSha256Digest(copy.digest)
    if (actualDigest !== expectedDigest) {
      throw new Error(`Digest mismatch for selected artifact file ${copy.sourcePath}`)
    }
    if (await pathExists(targetPath)) {
      const existingDigest = `sha256:${sha256Hex(await fs.readFile(targetPath))}`
      if (existingDigest !== copy.digest && !force) {
        throw new Error(`Refusing to overwrite modified file without --force: ${targetPath}`)
      }
    }
    if (!dryRun) {
      await ensureDir(path.dirname(targetPath))
      await fs.writeFile(targetPath, bytes)
    }
    installedFiles.push({ path: targetPath, sha256: expectedDigest })
  }
  return installedFiles
}

async function installSelectionJson(
  source: SelectionFileSource,
  rootDir: string,
  bundle: SelectionBundle,
  artifacts: readonly SelectedArtifactForBundle[],
  force: boolean,
  dryRun: boolean
) {
  const bySelector = new Map(artifacts.map((artifact) => [artifact.selector, artifact]))
  const writes: PluginJsonWrite[] = []
  for (const write of bundle.materialization.jsonWrites) {
    const artifact = bySelector.get(write.artifactSelector)
    if (!artifact) throw new Error(`Missing selected artifact for JSON write: ${write.artifactSelector}`)
    const sourceJson = await readArtifactJson(source, artifact)
    const value = selectJsonWriteValue(sourceJson, write.keyPath)
    const targetPath = resolveTargetPath(rootDir, write.path)
    const existing = (await readJsonFile<unknown>(targetPath)) ?? {}
    const existingRecord = toRecord(existing) ?? {}
    const previousValue = readJsonKey(existingRecord, write.keyPath)
    const next = mergeJsonWrite(existingRecord, write.keyPath, value, force, targetPath)
    if (!dryRun) {
      await ensureDir(path.dirname(targetPath))
      await writeJsonFile(targetPath, next)
    }
    writes.push(createProviderJsonWrite({
      path: targetPath,
      keyPath: write.keyPath,
      writtenValueDigest: digestJson(value),
      ...(previousValue === undefined ? {} : { previousValueDigest: digestJson(previousValue) }),
      keys: Object.keys(toRecord(value) ?? {}).sort(),
    }))
  }
  return writes
}

export async function uninstallArtifactSelection(input: ArtifactSelectionUninstallInput): Promise<ArtifactSelectionUninstallResult> {
  if (input.sourceKind === 'registry-artifact' && input.picks.length > 0) {
    throw new Error('Standalone registry artifact uninstall does not accept --pick values.')
  }
  if (input.sourceKind === 'registry-plugin' && input.picks.length === 0) {
    throw new Error('Selection uninstall requires at least one --pick value.')
  }
  const selectedSelectors = input.picks.map((pick) => normalizeSelectionPick(pick, input.defaultKind)).sort()
  const specIdentity = input.sourceKind === 'registry-artifact'
    ? await resolveRegistryArtifactInstallSpecIdentity(
      input.source,
      requireStandaloneRegistryArtifactKind(input.defaultKind),
      input.cwd,
      input.registries,
    )
    : await resolvePluginInstallSpecIdentity(input.source, input.cwd, input.registries)
  const ledgers = await loadPluginInstallLedgers(input.cwd)
  const records = listSelectionInstallRecords(ledgers, input.scope).filter(
    (record) =>
      record.provider === input.provider &&
      isSamePluginInstallSpecIdentity(record.specIdentity, specIdentity) &&
      (specIdentity.kind === 'registry-artifact' || sameSelectors(record.selectedSelectors, selectedSelectors))
  )
  if (records.length === 0) {
    return { removed: [], kept: [], missing: [], clearedRecordIds: [] }
  }

  const removed: string[] = []
  const kept: string[] = []
  const missing: string[] = []
  const clearedRecordIds: string[] = []
  for (const record of records) {
    const rootDir = resolveSelectionRoot(input.cwd, record.provider, record.scope)
    let recordKept = false
    for (const file of record.files) {
      const filePath = resolveTargetPath(rootDir, file.path)
      if (!(await pathExists(filePath))) {
        missing.push(filePath)
        continue
      }
      const actual = `sha256:${sha256Hex(await fs.readFile(filePath))}`
      if (actual !== file.sha256) {
        kept.push(filePath)
        recordKept = true
        continue
      }
      if (!input.dryRun) await fs.rm(filePath, { force: true })
      removed.push(filePath)
    }
    for (const write of record.jsonWrites) {
      const outcome = await removeJsonWrite(rootDir, write, Boolean(input.dryRun))
      removed.push(...outcome.removed)
      kept.push(...outcome.kept)
      missing.push(...outcome.missing)
      if (outcome.kept.length > 0) recordKept = true
    }
    if (!recordKept) clearedRecordIds.push(record.id)
  }

  if (!input.dryRun) {
    const idsByScope = new Map<PluginInstallScopeName, string[]>()
    for (const record of records) {
      if (!clearedRecordIds.includes(record.id)) continue
      idsByScope.set(record.scope, [...(idsByScope.get(record.scope) ?? []), record.id])
    }
    for (const [scope, ids] of idsByScope) {
      await removeSelectionInstallRecords(input.cwd, scope, ids)
    }
  }

  return { removed, kept, missing, clearedRecordIds }
}

type SelectionFileSource =
  | { kind: 'local-dir'; pluginDir: string }
  | { kind: 'tree'; tree: VirtualTree }

function resolveTargetPath(rootDir: string, relativePath: string) {
  return resolveContainedPath(rootDir, relativePath, 'selection target')
}

function resolveContainedPath(rootDir: string, relativePath: string, label: string) {
  const targetPath = path.resolve(rootDir, relativePath)
  const relative = path.relative(rootDir, targetPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe ${label} path: ${relativePath}`)
  }
  return targetPath
}

async function readArtifactJson(source: SelectionFileSource, artifact: Pick<SelectedArtifactForBundle, 'fileDigests' | 'selector'>) {
  const jsonFile = artifact.fileDigests
    .map((file) => file.path)
    .find((filePath) => filePath.endsWith('.json'))
  if (!jsonFile) throw new Error(`Selected artifact has no JSON config file: ${artifact.selector}`)
  const raw = JSON.parse(await readSourceText(source, jsonFile)) as unknown
  const record = toRecord(raw)
  if (!record) throw new Error(`Selected artifact JSON must be an object: ${jsonFile}`)
  return record
}

async function readSourceBytes(source: SelectionFileSource, relativePath: string) {
  if (source.kind === 'local-dir') {
    return fs.readFile(resolveContainedPath(source.pluginDir, relativePath, 'plugin source'))
  }
  if (!source.tree.readBytes) {
    throw new Error(`Virtual tree cannot provide bytes for selected artifact file: ${relativePath}`)
  }
  const bytes = await source.tree.readBytes(relativePath)
  if (!bytes) throw new Error(`Selected artifact file not found: ${relativePath}`)
  return bytes
}

async function readSourceText(source: SelectionFileSource, relativePath: string) {
  if (source.kind === 'local-dir') {
    return fs.readFile(resolveContainedPath(source.pluginDir, relativePath, 'plugin source'), 'utf-8')
  }
  const text = await source.tree.readText(relativePath)
  if (text == null) throw new Error(`Selected artifact file not found: ${relativePath}`)
  return text
}

function selectJsonWriteValue(sourceJson: Record<string, unknown>, keyPath: string) {
  if (keyPath === 'mcpServers') {
    return toRecord(sourceJson.mcpServers) ?? sourceJson
  }
  return sourceJson
}

function mergeJsonWrite(
  existing: Record<string, unknown>,
  keyPath: string,
  value: unknown,
  force: boolean,
  targetPath: string
) {
  if (keyPath === '$') {
    return mergeObjects(existing, value, force, targetPath)
  }
  const next = { ...existing }
  const current = toRecord(existing[keyPath]) ?? {}
  next[keyPath] = mergeObjects(current, value, force, targetPath)
  return next
}

function mergeObjects(existing: Record<string, unknown>, value: unknown, force: boolean, targetPath: string) {
  const incoming = toRecord(value)
  if (!incoming) throw new Error(`JSON write value must be an object for ${targetPath}`)
  for (const [key, nextValue] of Object.entries(incoming)) {
    if (key in existing && digestJson(existing[key]) !== digestJson(nextValue) && !force) {
      throw new Error(`Refusing to overwrite JSON key without --force: ${targetPath}:${key}`)
    }
  }
  return { ...existing, ...incoming }
}

function readJsonKey(existing: Record<string, unknown>, keyPath: string) {
  if (keyPath === '$') return existing
  return existing[keyPath]
}

async function removeJsonWrite(rootDir: string, write: PluginJsonWrite, dryRun: boolean) {
  const writePath = resolveTargetPath(rootDir, write.path)
  if (!(await pathExists(writePath))) return { removed: [], kept: [], missing: [writePath] }
  const raw = await readJsonFile<unknown>(writePath)
  const record = toRecord(raw)
  if (!record) return { removed: [], kept: [formatKeptModifiedJsonWrite(writePath, write.keyPath)], missing: [] }
  const keys = write.keys ?? []
  const target = write.keyPath === '$' ? record : toRecord(record[write.keyPath])
  if (!target) return { removed: [], kept: [], missing: [writePath] }
  const ownedSubset = Object.fromEntries(keys.filter((key) => key in target).map((key) => [key, target[key]]))
  if (digestJson(ownedSubset) !== write.writtenValueSha256) {
    return { removed: [], kept: [formatKeptModifiedJsonWrite(writePath, write.keyPath)], missing: [] }
  }
  if (!dryRun) {
    for (const key of keys) delete target[key]
    if (write.keyPath !== '$') record[write.keyPath] = target
    await writeJsonFile(writePath, record)
  }
  return { removed: [`${writePath}:${write.keyPath}`], kept: [], missing: [] }
}

function sameSelectors(left: string[], right: string[]) {
  return left.slice().sort().join('\n') === right.slice().sort().join('\n')
}

function requireStandaloneRegistryArtifactKind(kind: SelectableArtifactKind | undefined): ParsedRegistryArtifactKind {
  if (kind === 'skill' || kind === 'mcp' || kind === 'hook') return kind
  throw new Error('Standalone registry artifact uninstall requires a standalone artifact kind.')
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function digestJson(value: unknown) {
  return `sha256:${sha256Hex(new TextEncoder().encode(stableJson(value)))}`
}

function normalizeSha256Digest(digest: string) {
  return digest.startsWith('sha256:') ? digest : `sha256:${digest}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (toRecord(value)) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
