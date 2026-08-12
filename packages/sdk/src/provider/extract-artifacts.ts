import type { RepoScanReport, SignalFile } from '../repo-scan/types'
import type { VirtualTree } from '../repo-scan/virtual-tree'
import { listVirtualFiles, normalizeVirtualPath, virtualBasename } from '../repo-scan/virtual-tree'
import {
  artifactKindFromSignalKind,
  formatArtifactSelector,
  normalizeArtifactName,
  type SelectableArtifactKind,
} from './artifact-kinds'

export type ArtifactOrigin = 'standalone' | 'bundled'

export type ArtifactFileDigest = {
  path: string
  digest: string
  bytes?: number
}

export type ArtifactDependency = {
  kind: SelectableArtifactKind
  selector: string
}

export type ExtractedArtifact = {
  kind: SelectableArtifactKind
  origin: ArtifactOrigin
  name: string
  artifactId: string
  selector: string
  sourcePath: string
  paths: string[]
  fileDigests: ArtifactFileDigest[]
  dependencies: ArtifactDependency[]
  parentArtifactId?: string
  parentVersion?: string
  capabilitySet: string[]
  declaredNetworkDomains: string[]
  declaredSecrets: string[]
  runtimeRequirements: string[]
}

export type RegistryLockFileDigest = {
  path: string
  digest?: string
  sha256?: string
}

export type RegistryLockArtifact = {
  plugin?: string
  artifact_id?: string
  artifact_kind?: string
  version: string
  file_digests: RegistryLockFileDigest[]
  capability_set?: string[]
  declared_network_domains?: string[]
  declared_secrets?: string[]
  runtime_requirements?: string[]
  dependencies?: Array<{
    kind?: string
    artifact?: string
    selector?: string
    version?: string
    required_by?: string
    requiredBy?: string
    for_selector?: string
  }>
  snapshot_digest: string
}

export type ArtifactClosureStatus = 'closed' | 'requires-dependencies' | 'requires-full-source'

export type ArtifactClosure = {
  selector: string
  status: ArtifactClosureStatus
  requiredSelectors: string[]
  requiredPaths: string[]
  reason?: string
}

export type ArtifactClosureOptions = {
  selectedSelectors?: readonly string[]
}

export function extractArtifactsFromPluginLock(lock: RegistryLockArtifact): ExtractedArtifact[] {
  const parentArtifactId = lock.plugin ?? lock.artifact_id ?? 'plugin'
  const files = normalizeLockFiles(lock.file_digests)
  const groups = new Map<string, { kind: SelectableArtifactKind; name: string; sourcePath: string; paths: string[] }>()

  for (const file of files) {
    const skill = skillGroup(file.path)
    if (skill) addGroupFile(groups, skill.kind, skill.name, skill.sourcePath, file.path)

    const command = markdownGroup(file.path, 'commands', 'command')
    if (command) addGroupFile(groups, command.kind, command.name, command.sourcePath, file.path)

    const agent = markdownGroup(file.path, 'agents', 'agent')
    if (agent) addGroupFile(groups, agent.kind, agent.name, agent.sourcePath, file.path)

    const mcp = mcpGroup(file.path)
    if (mcp) addGroupFile(groups, mcp.kind, mcp.name, mcp.sourcePath, file.path)

    const hook = hookGroup(file.path)
    if (hook) addGroupFile(groups, hook.kind, hook.name, hook.sourcePath, file.path)
  }

  return [...groups.values()]
    .filter((group) => isCompleteLockGroup(group))
    .map((group) => artifactFromLockGroup(lock, parentArtifactId, group, files))
    .sort(artifactSort)
}

export function extractArtifactsFromRepoScan(report: Pick<RepoScanReport, 'signals' | 'digest'>): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = []
  for (const signal of report.signals) {
    const kind = artifactKindFromSignalKind(signal.kind)
    if (!kind) continue
    const name = normalizeArtifactName(signal.id)
    const selector = formatArtifactSelector(kind, name)
    const fileDigests = signal.files.map(signalFileDigest).sort(fileDigestSort)
    artifacts.push({
      kind,
      origin: 'standalone',
      name,
      artifactId: selector,
      selector,
      sourcePath: normalizeVirtualPath(signal.sourcePath),
      paths: fileDigests.map((file) => file.path),
      fileDigests,
      dependencies: [],
      capabilitySet: [],
      declaredNetworkDomains: [],
      declaredSecrets: [],
      runtimeRequirements: [],
    })
  }
  return artifacts.sort(artifactSort)
}

export async function detectArtifactClosure(
  tree: VirtualTree,
  artifact: Pick<ExtractedArtifact, 'selector' | 'sourcePath' | 'fileDigests' | 'dependencies'>,
  options: ArtifactClosureOptions = {}
): Promise<ArtifactClosure> {
  const selected = new Set(options.selectedSelectors ?? [])
  const missingDependencies = artifact.dependencies
    .map((dependency) => dependency.selector)
    .filter((selector) => !selected.has(selector))
    .sort()
  if (missingDependencies.length) {
    return {
      selector: artifact.selector,
      status: 'requires-dependencies',
      requiredSelectors: missingDependencies,
      requiredPaths: [],
      reason: 'Selected artifact has undeclared bundle dependencies.',
    }
  }

  const escapedFiles = artifact.fileDigests
    .map((file) => normalizeVirtualPath(file.path))
    .filter((file) => !isWithinSourcePath(file, artifact.sourcePath))
    .sort()
  if (escapedFiles.length) {
    return {
      selector: artifact.selector,
      status: 'requires-full-source',
      requiredSelectors: [],
      requiredPaths: escapedFiles,
      reason: 'Selected artifact includes files outside its artifact root.',
    }
  }

  const externalReferences = await findExternalPathReferences(
    tree,
    artifact.sourcePath,
    artifact.fileDigests.map((file) => file.path),
  )
  if (externalReferences.length) {
    return {
      selector: artifact.selector,
      status: 'requires-full-source',
      requiredSelectors: [],
      requiredPaths: externalReferences,
      reason: 'Selected artifact references paths outside its artifact root.',
    }
  }

  return {
    selector: artifact.selector,
    status: 'closed',
    requiredSelectors: [],
    requiredPaths: [],
  }
}

export async function extractArtifactsFromVirtualTree(tree: VirtualTree): Promise<ExtractedArtifact[]> {
  const files = await listVirtualFiles(tree)
  const lock: RegistryLockArtifact = {
    version: '0.0.0',
    file_digests: files.map((file) => ({ path: file.path, digest: file.sha256 })),
    snapshot_digest: '',
  }
  return extractArtifactsFromPluginLock(lock).map((artifact) => ({ ...artifact, origin: 'standalone' }))
}

function normalizeLockFiles(files: readonly RegistryLockFileDigest[]) {
  return files.map((file) => {
    const digest = file.digest ?? file.sha256
    if (!digest) {
      throw new Error(`Lock file digest is required for ${file.path}`)
    }
    return { path: normalizeVirtualPath(file.path), digest } satisfies ArtifactFileDigest
  }).sort(fileDigestSort)
}

function signalFileDigest(file: SignalFile): ArtifactFileDigest {
  return {
    path: normalizeVirtualPath(file.path),
    digest: file.sha256,
    bytes: file.bytes,
  }
}

function skillGroup(path: string) {
  const parts = path.split('/')
  if (parts.length < 3 || parts[0] !== 'skills') return null
  return { kind: 'skill' as const, name: parts[1], sourcePath: `skills/${parts[1]}` }
}

function markdownGroup(path: string, prefix: string, kind: 'command' | 'agent') {
  const parts = path.split('/')
  if (parts.length !== 2 || parts[0] !== prefix || !parts[1].endsWith('.md')) return null
  return { kind, name: parts[1].replace(/\.md$/i, ''), sourcePath: path }
}

function mcpGroup(path: string) {
  if (path === 'mcp.json') {
    return { kind: 'mcp' as const, name: 'mcp', sourcePath: path }
  }
  const parts = path.split('/')
  if (parts.length >= 3 && parts[0] === 'mcps') {
    return { kind: 'mcp' as const, name: parts[1], sourcePath: `mcps/${parts[1]}` }
  }
  return null
}

function hookGroup(path: string) {
  if (path === 'hooks.json') return { kind: 'hook' as const, name: 'hooks', sourcePath: path }
  const parts = path.split('/')
  const manifestIndex = parts.findIndex((part) => part === '.hook')
  if (manifestIndex >= 0 && parts[manifestIndex + 1] === 'hook.json') {
    const sourcePath = parts.slice(0, manifestIndex).join('/') || '.hook'
    const name = parts[manifestIndex - 1] ?? 'hook'
    return { kind: 'hook' as const, name, sourcePath }
  }
  if (path === 'hooks/hooks.json' || path.startsWith('hooks/')) {
    return { kind: 'hook' as const, name: 'hooks', sourcePath: 'hooks' }
  }
  return null
}

function addGroupFile(
  groups: Map<string, { kind: SelectableArtifactKind; name: string; sourcePath: string; paths: string[] }>,
  kind: SelectableArtifactKind,
  nameRaw: string,
  sourcePath: string,
  path: string
) {
  const name = normalizeArtifactName(nameRaw)
  const selector = formatArtifactSelector(kind, name)
  const existing = groups.get(selector)
  if (existing) {
    existing.paths.push(path)
    return
  }
  groups.set(selector, { kind, name, sourcePath, paths: [path] })
}

function isCompleteLockGroup(group: { kind: SelectableArtifactKind; sourcePath: string; paths: string[] }) {
  if (group.kind === 'skill') return group.paths.includes(`${group.sourcePath}/SKILL.md`)
  if (group.kind === 'mcp') return group.paths.length > 0
  if (group.kind === 'hook') {
    return group.paths.some((path) => path === 'hooks.json' || path === 'hooks/hooks.json' || path.endsWith('/.hook/hook.json'))
  }
  return group.paths.length > 0
}

function artifactFromLockGroup(
  lock: RegistryLockArtifact,
  parentArtifactId: string,
  group: { kind: SelectableArtifactKind; name: string; sourcePath: string; paths: string[] },
  files: ArtifactFileDigest[]
): ExtractedArtifact {
  const selector = formatArtifactSelector(group.kind, group.name)
  const pathSet = new Set(group.paths.map((path) => normalizeVirtualPath(path)))
  const fileDigests = files.filter((file) => pathSet.has(file.path)).sort(fileDigestSort)
  return {
    kind: group.kind,
    origin: 'bundled',
    name: group.name,
    artifactId: `${parentArtifactId}#${selector}`,
    parentArtifactId,
    parentVersion: lock.version,
    selector,
    sourcePath: group.sourcePath,
    paths: fileDigests.map((file) => file.path),
    fileDigests,
    dependencies: dependenciesForSelector(lock, selector),
    capabilitySet: lock.capability_set ?? [],
    declaredNetworkDomains: lock.declared_network_domains ?? [],
    declaredSecrets: lock.declared_secrets ?? [],
    runtimeRequirements: lock.runtime_requirements ?? [],
  }
}

function dependenciesForSelector(lock: RegistryLockArtifact, selector: string): ArtifactDependency[] {
  return (lock.dependencies ?? [])
    .filter((dependency) => dependencyOwnerSelector(dependency) === selector)
    .map((dependency) => {
      const dependencySelector = dependency.selector ?? dependency.artifact
      if (!dependency.kind || !dependencySelector) return null
      try {
        return {
          kind: dependency.kind as SelectableArtifactKind,
          selector: dependencySelector.includes(':') ? dependencySelector : formatArtifactSelector(dependency.kind as SelectableArtifactKind, dependencySelector),
        }
      } catch {
        return null
      }
    })
    .filter((dependency): dependency is ArtifactDependency => dependency != null && dependency.selector !== selector)
    .sort((left, right) => left.selector.localeCompare(right.selector))
}

function dependencyOwnerSelector(dependency: NonNullable<RegistryLockArtifact['dependencies']>[number]) {
  const owner = dependency.required_by ?? dependency.requiredBy ?? dependency.for_selector
  if (!owner) return null
  try {
    return owner.includes(':') ? owner : formatArtifactSelector('skill', owner)
  } catch {
    return null
  }
}

function isWithinSourcePath(path: string, sourcePath: string) {
  const normalizedPath = normalizeVirtualPath(path)
  const normalizedSource = normalizeVirtualPath(sourcePath)
  return normalizedPath === normalizedSource || normalizedPath.startsWith(`${normalizedSource}/`)
}

async function findExternalPathReferences(tree: VirtualTree, sourcePath: string, paths: string[]) {
  const matches = new Set<string>()
  const portableMcpConfig = sourcePath === 'mcp.json'
  for (const path of paths) {
    const text = await tree.readText(normalizeVirtualPath(path))
    if (!text) continue
    if (
      /(^|["'\s])\.\.\/[A-Za-z0-9_.\-/]+/.test(text)
      || /\$\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}\/[A-Za-z0-9_.\-/]+/.test(text)
      || (portableMcpConfig && /(^|["'\s:[,])\.\/[A-Za-z0-9_.\-/]+/.test(text))
    ) {
      matches.add(path)
    }
  }
  return [...matches].sort()
}

function fileDigestSort(left: { path: string }, right: { path: string }) {
  if (left.path === right.path) return 0
  return left.path < right.path ? -1 : 1
}

function artifactSort(left: ExtractedArtifact, right: ExtractedArtifact) {
  const leftKey = `${left.kind}:${left.selector}`
  const rightKey = `${right.kind}:${right.selector}`
  if (leftKey === rightKey) return 0
  return leftKey < rightKey ? -1 : 1
}
