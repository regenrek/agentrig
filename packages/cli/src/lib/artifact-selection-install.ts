import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  assertSelectionBundleInstallable,
  buildSelectionBundle,
  detectArtifactClosure,
  extractArtifactsFromPluginLock,
  formatArtifactSelector,
  normalizeSelectionPick,
  type ExtractedArtifact,
  type SelectableArtifactKind,
  type SelectionBundle,
  type SelectionProviderId,
} from '@agentrig/sdk'
import { createLocalFsVirtualTree } from '@agentrig/sdk/fs-adapters/local-fs'
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from './fs'
import { sha256Hex } from './hash'
import {
  getResolvedPluginSpecIdentity,
  getResolvedRegistryArtifactSpecIdentity,
  getResolvedVerifiedRegistryIdentity,
  isSamePluginInstallSpecIdentity,
  normalizePluginInstallSpecIdentity,
  normalizeRegistryArtifactInstallSpecIdentity,
} from './plugin-install-spec'
import type { ParsedRegistryArtifactKind } from './registry-spec'
import { registryArtifactSourcePath } from './registry'
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
import type { ResolvedPlugin } from './registry'
import type { ResolvedStandaloneArtifact } from './registry'
import type {
  PluginInstallScopeName,
  PluginInstallScopeSelectorName,
  PluginInstalledFile,
  PluginJsonWrite,
  RegistryRef,
  SelectionInstallRecord,
} from './types'

export type RegistryPluginSelectionInstallInput = {
  sourceKind?: 'registry-plugin'
  cwd: string
  provider: SelectionProviderId
  requestedScope: PluginInstallScopeSelectorName
  scope: PluginInstallScopeName
  registryRef: string
  resolved: ResolvedPlugin
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
  resolved: ResolvedStandaloneArtifact
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
    : extractArtifactsFromPluginLock(input.resolved.lockArtifact)
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
  const installedFiles = await installSelectionFiles(input.pluginDir, rootDir, bundle, Boolean(input.force), Boolean(input.dryRun))
  const jsonWrites = await installSelectionJson(input.pluginDir, rootDir, bundle, artifacts, Boolean(input.force), Boolean(input.dryRun))

  const record: SelectionInstallRecord = {
    id: `selection:${input.provider}:${input.scope}:${bundle.selectionId}`,
    provider: input.provider,
    requestedScope: input.requestedScope,
    specIdentity: input.sourceKind === 'registry-artifact'
      ? getResolvedRegistryArtifactSpecIdentity(input.resolved)
      : getResolvedPluginSpecIdentity(input.resolved),
    registry: getResolvedVerifiedRegistryIdentity(input.resolved),
    scope: input.scope,
    pluginId: input.sourceKind === 'registry-artifact' ? input.resolved.artifactId : input.resolved.manifest.id,
    pluginVersion: input.resolved.manifest.version,
    snapshotDigest: input.resolved.snapshotDigest,
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

function selectionSourceForInstall(input: ArtifactSelectionInstallInput) {
  if (input.sourceKind === 'registry-artifact') {
    return {
      kind: 'registry-artifact' as const,
      registryAlias: input.resolved.registry.name,
      registryUrl: input.resolved.registry.url,
      registryRef: input.registryRef,
      artifactKind: input.resolved.artifactKind,
      artifactId: input.resolved.artifactId,
      version: input.resolved.manifest.version,
      snapshotDigest: input.resolved.snapshotDigest,
    }
  }
  return {
    kind: 'registry-plugin' as const,
    registryAlias: input.resolved.registry.name,
    registryUrl: input.resolved.registry.url,
    registryRef: input.registryRef,
    artifactId: input.resolved.manifest.id,
    version: input.resolved.manifest.version,
    snapshotDigest: input.resolved.snapshotDigest,
  }
}

function artifactFromStandaloneRegistryArtifact(resolved: ResolvedStandaloneArtifact): ExtractedArtifact {
  const sourcePath = registryArtifactSourcePath(resolved.artifactKind, resolved.artifactId)
  const name = sourcePath.split('/').pop() ?? resolved.artifactId
  const selector = formatArtifactSelector(resolved.artifactKind, name)
  return {
    kind: resolved.artifactKind,
    origin: 'standalone',
    name,
    artifactId: resolved.artifactId,
    selector,
    sourcePath,
    paths: resolved.lockArtifact.file_digests.map((file) => `${sourcePath}/${file.path}`),
    fileDigests: resolved.lockArtifact.file_digests.map((file) => ({
      path: `${sourcePath}/${file.path}`,
      digest: file.digest,
    })),
    dependencies: [],
    capabilitySet: resolved.lockArtifact.capability_set,
    declaredNetworkDomains: resolved.lockArtifact.declared_network_domains,
    declaredSecrets: resolved.lockArtifact.declared_secrets,
    runtimeRequirements: resolved.lockArtifact.runtime_requirements,
  }
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
    return scope === 'workspace' ? path.join(cwd, '.claude') : path.join(homedir(), '.claude')
  }
  if (provider === 'codex') {
    return scope === 'workspace' ? path.join(cwd, '.codex') : path.join(homedir(), '.codex')
  }
  return scope === 'workspace' ? cwd : homedir()
}

async function installSelectionFiles(
  pluginDir: string,
  rootDir: string,
  bundle: SelectionBundle,
  force: boolean,
  dryRun: boolean
) {
  const installedFiles: PluginInstalledFile[] = []
  for (const copy of bundle.materialization.fileCopies) {
    const sourcePath = resolvePluginPath(pluginDir, copy.sourcePath)
    const targetPath = resolveTargetPath(rootDir, copy.targetPath)
    const bytes = await fs.readFile(sourcePath)
    const actualDigest = `sha256:${sha256Hex(bytes)}`
    if (actualDigest !== copy.digest) {
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
    installedFiles.push({ path: targetPath, sha256: copy.digest })
  }
  return installedFiles
}

async function installSelectionJson(
  pluginDir: string,
  rootDir: string,
  bundle: SelectionBundle,
  artifacts: ExtractedArtifact[],
  force: boolean,
  dryRun: boolean
) {
  const bySelector = new Map(artifacts.map((artifact) => [artifact.selector, artifact]))
  const writes: PluginJsonWrite[] = []
  for (const write of bundle.materialization.jsonWrites) {
    const artifact = bySelector.get(write.artifactSelector)
    if (!artifact) throw new Error(`Missing selected artifact for JSON write: ${write.artifactSelector}`)
    const sourceJson = await readArtifactJson(pluginDir, artifact)
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
    ? normalizeRegistryArtifactInstallSpecIdentity(
      input.source,
      requireStandaloneRegistryArtifactKind(input.defaultKind),
      input.cwd,
      input.registries,
    )
    : normalizePluginInstallSpecIdentity(input.source, input.cwd, input.registries)
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
    let recordKept = false
    for (const file of record.files) {
      if (!(await pathExists(file.path))) {
        missing.push(file.path)
        continue
      }
      const actual = `sha256:${sha256Hex(await fs.readFile(file.path))}`
      if (actual !== file.sha256) {
        kept.push(file.path)
        recordKept = true
        continue
      }
      if (!input.dryRun) await fs.rm(file.path, { force: true })
      removed.push(file.path)
    }
    for (const write of record.jsonWrites) {
      const outcome = await removeJsonWrite(write, Boolean(input.dryRun))
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

function resolvePluginPath(pluginDir: string, relativePath: string) {
  return resolveContainedPath(pluginDir, relativePath, 'plugin source')
}

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

async function readArtifactJson(pluginDir: string, artifact: ExtractedArtifact) {
  const jsonFile = artifact.fileDigests
    .map((file) => file.path)
    .find((filePath) => filePath.endsWith('.json'))
  if (!jsonFile) throw new Error(`Selected artifact has no JSON config file: ${artifact.selector}`)
  const raw = await readJsonFile<unknown>(resolvePluginPath(pluginDir, jsonFile))
  const record = toRecord(raw)
  if (!record) throw new Error(`Selected artifact JSON must be an object: ${jsonFile}`)
  return record
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

async function removeJsonWrite(write: PluginJsonWrite, dryRun: boolean) {
  if (!(await pathExists(write.path))) return { removed: [], kept: [], missing: [write.path] }
  const raw = await readJsonFile<unknown>(write.path)
  const record = toRecord(raw)
  if (!record) return { removed: [], kept: [formatKeptModifiedJsonWrite(write.path, write.keyPath)], missing: [] }
  const keys = write.keys ?? []
  const target = write.keyPath === '$' ? record : toRecord(record[write.keyPath])
  if (!target) return { removed: [], kept: [], missing: [write.path] }
  const ownedSubset = Object.fromEntries(keys.filter((key) => key in target).map((key) => [key, target[key]]))
  if (digestJson(ownedSubset) !== write.writtenValueSha256) {
    return { removed: [], kept: [formatKeptModifiedJsonWrite(write.path, write.keyPath)], missing: [] }
  }
  if (!dryRun) {
    for (const key of keys) delete target[key]
    if (write.keyPath !== '$') record[write.keyPath] = target
    await writeJsonFile(write.path, record)
  }
  return { removed: [`${write.path}:${write.keyPath}`], kept: [], missing: [] }
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
