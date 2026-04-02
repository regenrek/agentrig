import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

type PluginFile = {
  path: string
  mode?: string
  sha256?: string
}

type PluginManifest = {
  $schema?: string
  kind?: string
  id: string
  name: string
  description: string
  version: string
  author?: string | null
  license?: string | null
  keywords?: string[]
  pluginDependencies?: string[]
  configSchema?: Record<string, unknown>
  'x-agentrig'?: Record<string, unknown>
}

type PluginInstallMetadata = {
  $schema?: string
  files: PluginFile[]
}

type HistoryManifest = {
  $schema?: string
  id: string
  name: string
  latest: string
  versions: string[]
  description: string
  keywords?: string[]
  trustTier: 'official'
  paths: {
    plugin: string
    manifest: string
  }
}

type RegistryIndexItem = {
  id: string
  name: string
  description: string
  version: string
  keywords?: string[]
  manifest: string
}

type RegistryIndex = {
  $schema?: string
  name: string
  homepage?: string
  generatedAt?: string
  items: RegistryIndexItem[]
}

type BuildRegistryOptions = {
  repoRoot: string
  pluginRoot?: string
  outputRoot?: string
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?$/
const REGISTRY_SCHEMA_URL = 'https://agentrig.ai/schema/registry.v1.json'
const PLUGIN_SCHEMA_URL = 'https://agentrig.ai/schema/plugin.v1.json'
const PLUGIN_HISTORY_SCHEMA_URL = 'https://agentrig.ai/schema/plugin-history.v1.json'
const PLUGIN_INSTALL_SCHEMA_URL = 'https://agentrig.ai/schema/plugin-install.v1.json'

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

async function pathExists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
}

function isSafeRelativePath(value: string) {
  if (!value) return false
  if (value.startsWith('/') || value.startsWith('\\\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized === '..' ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.startsWith('./') ||
    normalized.endsWith('/..') ||
    normalized.includes('/../')
  ) {
    return false
  }
  return true
}

function resolveSafePath(root: string, relativePath: string, label: string) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Invalid ${label}: ${relativePath}`)
  }
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path traversal blocked for ${label}: ${relativePath}`)
  }
  return resolvedPath
}

function isSubpath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (!relative) return false
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function assertSafeOutputRoot(repoRoot: string, outputRoot: string) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const resolvedOutputRoot = path.resolve(outputRoot)
  const filesystemRoot = path.parse(resolvedOutputRoot).root
  if (resolvedOutputRoot === filesystemRoot) {
    throw new Error(`Refusing to delete filesystem root: ${resolvedOutputRoot}`)
  }

  const defaultOutputRoot = path.join(
    resolvedRepoRoot,
    'apps',
    'docs',
    'public',
    'registry',
  )
  const localWebOutputRoot = path.join(resolvedRepoRoot, 'public', 'registry')
  const siblingWebOutputRoot = path.resolve(resolvedRepoRoot, '..', 'agentrig-web', 'public', 'registry')
  if (
    resolvedOutputRoot === defaultOutputRoot ||
    resolvedOutputRoot === localWebOutputRoot ||
    resolvedOutputRoot === siblingWebOutputRoot
  ) {
    return
  }

  const tmpRoot = path.resolve(os.tmpdir())
  if (isSubpath(tmpRoot, resolvedOutputRoot)) return

  throw new Error(
    `Unsafe outputRoot: ${resolvedOutputRoot}. Must be ${defaultOutputRoot}, ${localWebOutputRoot}, ${siblingWebOutputRoot}, or within ${tmpRoot}`,
  )
}

function assertPluginManifest(manifest: unknown, pluginDir: string): asserts manifest is PluginManifest {
  const where = `.plugin/plugin.json in ${pluginDir}`
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid ${where}: not an object`)
  }
  const current = manifest as Record<string, unknown>
  if (typeof current.$schema === 'string' && current.$schema !== PLUGIN_SCHEMA_URL) {
    throw new Error(`Invalid ${where}: $schema must be "${PLUGIN_SCHEMA_URL}"`)
  }
  for (const key of ['id', 'name', 'description', 'version']) {
    if (typeof current[key] !== 'string' || !String(current[key]).trim()) {
      throw new Error(`Invalid ${where}: missing ${key}`)
    }
  }
  const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
  if (!PLUGIN_ID_PATTERN.test(String(current.id))) {
    throw new Error(`Invalid ${where}: id "${current.id}" must be lowercase letters, numbers, and hyphens only`)
  }
  if (current.kind !== 'agentrig:plugin') {
    throw new Error(`Invalid ${where}: kind must be "agentrig:plugin"`)
  }
  if ('license' in current && typeof current.license !== 'string') {
    throw new Error(`Invalid ${where}: license must be omitted or a string`)
  }
  if ('author' in current && typeof current.author !== 'string') {
    throw new Error(`Invalid ${where}: author must be omitted or a string`)
  }
  if (typeof current.configSchema !== 'object' || current.configSchema == null || Array.isArray(current.configSchema)) {
    throw new Error(`Invalid ${where}: configSchema must be a non-null, non-array object`)
  }
  if ('files' in current) {
    throw new Error(`Invalid ${where}: source plugin manifests must not include delivery files metadata`)
  }
}

function parseSemver(version: string) {
  const match = version.match(SEMVER_PATTERN)
  if (!match) {
    throw new Error(`Invalid semver: ${version}`)
  }
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareSemverIdentifiers(left: string, right: string) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10)
  }
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left.localeCompare(right)
}

function compareSemver(left: string, right: string) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    const comparison = compareSemverIdentifiers(leftPart, rightPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    )
  }
  return value
}

function assertHistoryManifest(
  manifest: unknown,
  pluginId: string,
  versions: string[],
  latestManifest: PluginManifest,
): asserts manifest is HistoryManifest {
  const where = `manifests/${pluginId}.json`
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Invalid ${where}: not an object`)
  }

  const current = manifest as Record<string, unknown>
  if (typeof current.$schema === 'string' && current.$schema !== PLUGIN_HISTORY_SCHEMA_URL) {
    throw new Error(`Invalid ${where}: $schema must be "${PLUGIN_HISTORY_SCHEMA_URL}"`)
  }
  if (current.id !== pluginId) {
    throw new Error(`Invalid ${where}: id must be "${pluginId}"`)
  }
  if (current.name !== latestManifest.name) {
    throw new Error(`Invalid ${where}: name must match latest plugin manifest`)
  }
  if (current.description !== latestManifest.description) {
    throw new Error(`Invalid ${where}: description must match latest plugin manifest`)
  }
  if (current.latest !== latestManifest.version) {
    throw new Error(`Invalid ${where}: latest must be "${latestManifest.version}"`)
  }
  if (!Array.isArray(current.versions) || current.versions.length === 0) {
    throw new Error(`Invalid ${where}: versions must be a non-empty array`)
  }

  const expectedVersions = [...versions].sort((left, right) => compareSemver(left, right))
  const actualVersions = current.versions.map((value) => String(value))
  if (stableJson(actualVersions) !== stableJson(expectedVersions)) {
    throw new Error(`Invalid ${where}: versions must match plugin directories`)
  }

  const keywords = Array.isArray(current.keywords)
    ? current.keywords.map((value) => String(value))
    : []
  if (stableJson(keywords) !== stableJson(latestManifest.keywords ?? [])) {
    throw new Error(`Invalid ${where}: keywords must match latest plugin manifest`)
  }

  if (current.trustTier !== 'official') {
    throw new Error(`Invalid ${where}: trustTier must be "official"`)
  }

  const paths = current.paths
  if (!paths || typeof paths !== 'object') {
    throw new Error(`Invalid ${where}: paths are required`)
  }
  const currentPaths = paths as Record<string, unknown>
  const expectedPluginPath = `plugins/${pluginId}/${latestManifest.version}`
  if (currentPaths.plugin !== expectedPluginPath) {
    throw new Error(`Invalid ${where}: paths.plugin must be "${expectedPluginPath}"`)
  }
  const expectedManifestPath = `manifests/${pluginId}.json`
  if (currentPaths.manifest !== expectedManifestPath) {
    throw new Error(`Invalid ${where}: paths.manifest must be "${expectedManifestPath}"`)
  }
}

function assertRegistryIndex(index: unknown, expectedItems: RegistryIndexItem[]) {
  const where = 'registry.json'
  if (!index || typeof index !== 'object') {
    throw new Error(`Invalid ${where}: not an object`)
  }

  const current = index as Record<string, unknown>
  if (typeof current.$schema === 'string' && current.$schema !== REGISTRY_SCHEMA_URL) {
    throw new Error(`Invalid ${where}: $schema must be "${REGISTRY_SCHEMA_URL}"`)
  }
  if (typeof current.name !== 'string' || !current.name.trim()) {
    throw new Error(`Invalid ${where}: name is required`)
  }
  if (typeof current.homepage !== 'string' || !current.homepage.trim()) {
    throw new Error(`Invalid ${where}: homepage is required`)
  }
  if (!Array.isArray(current.items)) {
    throw new Error(`Invalid ${where}: items must be an array`)
  }

  const actualItems = current.items as RegistryIndexItem[]
  if (stableJson(actualItems) !== stableJson(expectedItems)) {
    throw new Error(`Invalid ${where}: items do not match the canonical source registry`)
  }
}

async function walkFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const sourcePath = path.join(currentDir, entry.name)
    const relativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/')
    const stat = await fs.lstat(sourcePath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in registry sources: ${sourcePath}`)
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(rootDir, sourcePath)))
      continue
    }
    if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

async function buildDerivedPluginInstallMetadata(
  versionDir: string,
  pluginId: string,
  canonicalManifest: PluginManifest
): Promise<PluginInstallMetadata> {
  const sourceInstallMetadataPath = path.join(versionDir, '.plugin', 'install.json')
  if (await pathExists(sourceInstallMetadataPath)) {
    throw new Error(`Source plugin must not include derived install metadata: ${sourceInstallMetadataPath}`)
  }
  const canonicalManifestBytes = Buffer.from(JSON.stringify(canonicalManifest, null, 2) + '\n', 'utf-8')
  const files = await walkFiles(versionDir)
  const compiledFiles: PluginFile[] = []
  for (const relativeFile of files) {
    const sourceFile = resolveSafePath(versionDir, relativeFile, `plugin file path for ${pluginId}`)
    const stat = await fs.stat(sourceFile)
    const isManifest = relativeFile === '.plugin/plugin.json'
    const buffer = isManifest ? canonicalManifestBytes : await fs.readFile(sourceFile)
    compiledFiles.push({
      path: relativeFile,
      mode: (stat.mode & 0o111) !== 0 ? '755' : undefined,
      sha256: sha256(buffer),
    })
  }
  return {
    $schema: PLUGIN_INSTALL_SCHEMA_URL,
    files: compiledFiles,
  }
}

function resolveDefaultPluginRoot(repoRoot: string) {
  return path.join(repoRoot, '..', 'agentrig-registry', 'plugins')
}

export async function buildRegistry({ repoRoot, pluginRoot, outputRoot }: BuildRegistryOptions) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const resolvedPluginRoot = pluginRoot
    ? path.resolve(pluginRoot)
    : path.resolve(resolveDefaultPluginRoot(resolvedRepoRoot))
  const resolvedRegistryRoot = path.resolve(path.join(resolvedPluginRoot, '..'))
  const resolvedManifestRoot = path.join(resolvedRegistryRoot, 'manifests')
  const sourceRegistryIndexPath = path.join(resolvedRegistryRoot, 'registry.json')
  const webPublicRegistryRoot = outputRoot
    ? path.resolve(outputRoot)
    : path.join(resolvedRepoRoot, 'apps', 'docs', 'public', 'registry')
  assertSafeOutputRoot(resolvedRepoRoot, webPublicRegistryRoot)

  if (!(await pathExists(resolvedPluginRoot))) {
    throw new Error(`Missing plugins directory: ${resolvedPluginRoot}`)
  }
  if (!(await pathExists(resolvedManifestRoot))) {
    throw new Error(`Missing manifests directory: ${resolvedManifestRoot}`)
  }
  if (!(await pathExists(sourceRegistryIndexPath))) {
    throw new Error(`Missing registry index: ${sourceRegistryIndexPath}`)
  }

  const sourceRegistryIndex = await readJsonFile<RegistryIndex>(sourceRegistryIndexPath)
  const pluginDirs = (await fs.readdir(resolvedPluginRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resolvedPluginRoot, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))

  const builtPlugins: Array<{
    pluginId: string
    latestVersion: string
    sourceVersionDir: string
    manifest: PluginManifest
    installMetadata: PluginInstallMetadata
  }> = []
  const items: RegistryIndexItem[] = []

  for (const pluginDir of pluginDirs) {
    const pluginId = path.basename(pluginDir)
    const versionDirs = (await fs.readdir(pluginDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => compareSemver(right, left))

    if (!versionDirs.length) continue

    const latestVersion = versionDirs[0]!
    const latestDir = path.join(pluginDir, latestVersion)
    const latestManifestPath = path.join(latestDir, '.plugin', 'plugin.json')
    if (!(await pathExists(latestManifestPath))) {
      throw new Error(`Missing .plugin/plugin.json for plugin "${pluginId}"`)
    }

    const latestManifest = await readJsonFile<PluginManifest>(latestManifestPath)
    assertPluginManifest(latestManifest, latestDir)
    if (latestManifest.id !== pluginId) {
      throw new Error(`Plugin id mismatch for ${latestDir}: expected ${pluginId}, got ${latestManifest.id}`)
    }
    if (latestManifest.version !== latestVersion) {
      throw new Error(
        `Plugin version mismatch for ${latestDir}: expected ${latestVersion}, got ${latestManifest.version}`,
      )
    }

    for (const version of versionDirs) {
      parseSemver(version)
      const manifestPath = path.join(pluginDir, version, '.plugin', 'plugin.json')
      if (!(await pathExists(manifestPath))) {
        throw new Error(`Missing .plugin/plugin.json for plugin "${pluginId}" version "${version}"`)
      }
      const manifest = await readJsonFile<PluginManifest>(manifestPath)
      assertPluginManifest(manifest, path.join(pluginDir, version))
      if (manifest.id !== pluginId || manifest.version !== version) {
        throw new Error(`Plugin metadata must match directory path for ${pluginId}/${version}`)
      }
    }

    const historyManifestPath = path.join(resolvedManifestRoot, `${pluginId}.json`)
    if (!(await pathExists(historyManifestPath))) {
      throw new Error(`Missing history manifest for plugin "${pluginId}"`)
    }
    const historyManifest = await readJsonFile<HistoryManifest>(historyManifestPath)
    assertHistoryManifest(historyManifest, pluginId, versionDirs, latestManifest)

    builtPlugins.push({
      pluginId,
      latestVersion,
      sourceVersionDir: latestDir,
      manifest: latestManifest,
      installMetadata: await buildDerivedPluginInstallMetadata(latestDir, pluginId, latestManifest),
    })

    items.push({
      id: latestManifest.id,
      name: latestManifest.name,
      description: latestManifest.description,
      version: latestManifest.version,
      keywords: latestManifest.keywords ?? undefined,
      manifest: `manifests/${pluginId}.json`,
    })
  }

  assertRegistryIndex(sourceRegistryIndex, items)

  await fs.rm(webPublicRegistryRoot, { recursive: true, force: true })
  await fs.mkdir(webPublicRegistryRoot, { recursive: true })
  await fs.cp(resolvedManifestRoot, path.join(webPublicRegistryRoot, 'manifests'), {
    recursive: true,
    force: true,
  })

  for (const builtPlugin of builtPlugins) {
    const outPluginDir = path.join(
      webPublicRegistryRoot,
      'plugins',
      builtPlugin.pluginId,
      builtPlugin.latestVersion,
    )
    await fs.mkdir(path.dirname(outPluginDir), { recursive: true })
    await fs.cp(builtPlugin.sourceVersionDir, outPluginDir, {
      recursive: true,
      force: true,
    })
    await fs.writeFile(
      path.join(outPluginDir, '.plugin', 'plugin.json'),
      JSON.stringify(builtPlugin.manifest, null, 2) + '\n',
      'utf-8',
    )
    await fs.writeFile(
      path.join(outPluginDir, '.plugin', 'install.json'),
      JSON.stringify(builtPlugin.installMetadata, null, 2) + '\n',
      'utf-8',
    )
  }

  const registryIndex: RegistryIndex = {
    $schema: REGISTRY_SCHEMA_URL,
    name: sourceRegistryIndex.name,
    homepage: sourceRegistryIndex.homepage,
    generatedAt: new Date().toISOString(),
    items,
  }

  await fs.writeFile(
    path.join(webPublicRegistryRoot, 'registry.json'),
    JSON.stringify(registryIndex, null, 2) + '\n',
    'utf-8',
  )

  console.log(`Built registry with ${items.length} plugin(s)`)
  console.log(`Source: ${resolvedPluginRoot}`)
  console.log(`Output: ${webPublicRegistryRoot}`)
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  await buildRegistry({ repoRoot })
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return import.meta.url === pathToFileURL(argv1).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
