import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PluginFeatures } from '@agentrig/sdk'
import { z } from 'zod'
import { ensureDir, pathExists, readJsonFile } from '../fs'
import { sha256Hex } from '../hash'
import { isValidPluginId, isValidPluginVersion } from '../plugin-validation'
import type {
  PluginInstallRecord,
  PluginInstallSpecIdentity,
  PluginInstalledFile,
  PluginInstallScopeSelectorName,
  VerifiedRegistryIdentity,
} from '../types'

const execFile = promisify(execFileCallback)

export const PLUGIN_PROVIDER_IDS = ['claude', 'codex', 'cursor'] as const
export const PLUGIN_INSTALL_SCOPES = ['personal', 'workspace'] as const
export const PLUGIN_INSTALL_SCOPE_SELECTORS = ['auto', 'personal', 'workspace'] as const

export type PluginProviderId = (typeof PLUGIN_PROVIDER_IDS)[number]
export type PluginProviderSelector = PluginProviderId | 'all'
export type PluginInstallScope = (typeof PLUGIN_INSTALL_SCOPES)[number]
export type PluginInstallScopeSelector = PluginInstallScopeSelectorName

export type PluginOwner = {
  name: string
  email?: string
}

export type ClaudeMarketplaceConfig = {
  marketplaceName?: string
  metadata?: {
    description?: string
    version?: string
    pluginRoot?: string
  }
}

export type CodexMarketplaceConfig = {
  marketplaceName?: string
  displayName?: string
  category?: string
  installationPolicy?: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE'
  authenticationPolicy?: 'ON_INSTALL' | 'ON_FIRST_USE'
  pluginRoot?: string
}

export type CursorMarketplaceConfig = {
  marketplaceName?: string
  metadata?: {
    description?: string
    version?: string
    pluginRoot?: string
  }
}

type PluginConfigFile = {
  pluginPrefix?: string
  owner?: Partial<PluginOwner>
  providers?: {
    claude?: ClaudeMarketplaceConfig
    codex?: CodexMarketplaceConfig
    cursor?: CursorMarketplaceConfig
  }
}

export type ResolvedPluginConfig = {
  pluginPrefix: string
  owner: PluginOwner
  providers: {
    claude: Required<ClaudeMarketplaceConfig>
    codex: Required<CodexMarketplaceConfig>
    cursor: Required<CursorMarketplaceConfig>
  }
}

export type PluginSourceManifest = z.infer<typeof pluginManifestSchema>

export type PluginEntry = {
  manifest: PluginSourceManifest
  pluginSourceDir: string
  pluginName: string
}

export type { PluginFeatures }

export type ProviderExportResult = {
  provider: PluginProviderId
  outRoot: string
  marketplaceName: string
  plugins: PluginEntry[]
}

export type ProviderInstallPreview = {
  provider: PluginProviderId
  scope: PluginInstallScope
  locations: string[]
  actions: string[]
}

export type ProviderInstallResult = {
  provider: PluginProviderId
  scope: PluginInstallScope
  installed: string[]
  skipped: string[]
  locations: string[]
  ledgerEntries: PluginInstallRecord[]
}

export type ProviderUninstallResult = {
  provider: PluginProviderId
  removed: string[]
  kept: string[]
  missing: string[]
  locations: string[]
  clearedRecordIds: string[]
}

export type PluginExportOptions = {
  cwd: string
  agent: PluginProviderSelector
  pluginsDir: string
  out?: string
  configPath?: string
  marketplaceName?: string
  ownerName?: string
  ownerEmail?: string
  pluginPrefix?: string
  clean?: boolean
  plugin?: string
}

export type ExternalCommandRunner = (command: string, args: string[]) => Promise<void>

export type ResolvedPluginInstallMetadata = {
  specIdentity: PluginInstallSpecIdentity
  registry?: VerifiedRegistryIdentity
  snapshotDigest: string
}

export type PluginInstallOptions = PluginExportOptions & {
  scope?: PluginInstallScopeSelector
  installMetadataByPluginId: Record<string, ResolvedPluginInstallMetadata>
  force?: boolean
  dryRun?: boolean
  commandRunner?: ExternalCommandRunner
}

export type PreparedProviderInstall = {
  provider: PluginProviderId
  scope: PluginInstallScope
  preview: ProviderInstallPreview
}

export type PreparedPluginInstall = {
  cwd: string
  cfg: ResolvedPluginConfig
  pluginsRoot: string
  plugins: PluginEntry[]
  baseOut: string
  out?: string
  clean: boolean
  force: boolean
  dryRun: boolean
  installMetadataByPluginId: Record<string, ResolvedPluginInstallMetadata>
  requestedScope: PluginInstallScopeSelector
  providers: PreparedProviderInstall[]
  commandRunner: ExternalCommandRunner
  exportOptions: PluginExportOptions
}

export type PluginUninstallOptions = {
  cwd: string
  dryRun?: boolean
  commandRunner?: ExternalCommandRunner
}

export type ProviderInstallPreviewContext = {
  cwd: string
  outRoot: string
  cfg: ResolvedPluginConfig
  plugins: PluginEntry[]
  scope: PluginInstallScope
}

export type PluginProviderAdapter = {
  id: PluginProviderId
  exportMarketplace(args: ProviderExportContext): Promise<ProviderExportResult>
  previewInstall(args: ProviderInstallPreviewContext): ProviderInstallPreview
  install(args: ProviderInstallContext): Promise<ProviderInstallResult>
  uninstall(args: ProviderUninstallContext): Promise<ProviderUninstallResult>
}

export type ProviderExportContext = {
  outRoot: string
  cfg: ResolvedPluginConfig
  plugins: PluginEntry[]
}

export type ProviderInstallContext = {
  cwd: string
  result: ProviderExportResult
  cfg: ResolvedPluginConfig
  scope: PluginInstallScope
  requestedScope: PluginInstallScopeSelector
  installMetadataByPluginId: Record<string, ResolvedPluginInstallMetadata>
  force: boolean
  dryRun: boolean
  runner: ExternalCommandRunner
}

export type ProviderUninstallContext = {
  cwd: string
  entries: PluginInstallRecord[]
  remainingEntries: PluginInstallRecord[]
  dryRun: boolean
  runner: ExternalCommandRunner
}

export type FileRemovalSummary = {
  removed: string[]
  kept: string[]
  missing: string[]
}

type CopyEntrySpec =
  | string
  | {
      source: string
      destination: string
    }

const nonEmptyStringSchema = z.string().trim().min(1)
const optionalStringSchema = nonEmptyStringSchema.optional()
const pluginProviderIdSchema = z.enum(PLUGIN_PROVIDER_IDS)
const pluginInstallScopeSchema = z.enum(PLUGIN_INSTALL_SCOPES)
const pluginInstallScopeSelectorSchema = z.enum(PLUGIN_INSTALL_SCOPE_SELECTORS)
const pluginProviderSelectorSchema = z.union([pluginProviderIdSchema, z.literal('all')])
const pluginMetadataSchema = z.object({
  description: optionalStringSchema,
  version: optionalStringSchema,
  pluginRoot: optionalStringSchema,
}).strict()
const pluginOwnerSchema = z.object({
  name: optionalStringSchema,
  email: optionalStringSchema,
}).strict()
const claudeMarketplaceConfigSchema = z.object({
  marketplaceName: optionalStringSchema,
  metadata: pluginMetadataSchema.optional(),
}).strict()
const codexMarketplaceConfigSchema = z.object({
  marketplaceName: optionalStringSchema,
  displayName: optionalStringSchema,
  category: optionalStringSchema,
  installationPolicy: z.enum(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE']).optional(),
  authenticationPolicy: z.enum(['ON_INSTALL', 'ON_FIRST_USE']).optional(),
  pluginRoot: optionalStringSchema,
}).strict()
const cursorMarketplaceConfigSchema = z.object({
  marketplaceName: optionalStringSchema,
  metadata: pluginMetadataSchema.optional(),
}).strict()
const pluginConfigFileSchema = z.object({
  pluginPrefix: optionalStringSchema,
  owner: pluginOwnerSchema.optional(),
  providers: z
    .object({
      claude: claudeMarketplaceConfigSchema.optional(),
      codex: codexMarketplaceConfigSchema.optional(),
      cursor: cursorMarketplaceConfigSchema.optional(),
    })
    .strict()
    .optional(),
}).strict()
const pluginManifestSchema = z.object({
  $schema: z.string().optional(),
  kind: z.literal('agentrig:plugin'),
  id: nonEmptyStringSchema.refine(isValidPluginId, 'Plugin id must be lowercase letters, numbers, or hyphens'),
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  version: nonEmptyStringSchema.refine(isValidPluginVersion, 'Plugin version must be valid semver (x.y.z)'),
  author: optionalStringSchema,
  license: optionalStringSchema,
  keywords: z.array(nonEmptyStringSchema).optional(),
  pluginDependencies: z.array(nonEmptyStringSchema).optional(),
  configSchema: z.object({}).passthrough(),
  'x-agentrig': z.object({}).passthrough().optional(),
}).strict()

const DEFAULT_CONFIG: ResolvedPluginConfig = {
  pluginPrefix: 'agentrig-',
  owner: {
    name: 'Agentrig',
  },
  providers: {
    claude: {
      marketplaceName: 'agentrig-community',
      metadata: {
        description: 'AgentRig workflow plugins exported as provider-native plugins.',
        version: '1.0.0',
        pluginRoot: './plugins',
      },
    },
    codex: {
      marketplaceName: 'agentrig-local',
      displayName: 'Agentrig Local',
      category: 'Productivity',
      installationPolicy: 'AVAILABLE',
      authenticationPolicy: 'ON_INSTALL',
      pluginRoot: './plugins',
    },
    cursor: {
      marketplaceName: 'agentrig-marketplace',
      metadata: {
        description: 'AgentRig plugins exported as Cursor plugins.',
        version: '1.0.0',
        pluginRoot: 'plugins',
      },
    },
  },
}

export function isPluginProviderId(value: string): value is PluginProviderId {
  return (PLUGIN_PROVIDER_IDS as readonly string[]).includes(value)
}

export function resolvePluginProviders(target: PluginProviderSelector) {
  if (target === 'all') return [...PLUGIN_PROVIDER_IDS]
  return [target]
}

export function resolveInstallScope(
  provider: PluginProviderId,
  requestedScope: PluginInstallScopeSelector = 'auto'
): PluginInstallScope {
  if (requestedScope !== 'auto') return requestedScope
  return provider === 'cursor' ? 'personal' : 'workspace'
}

export function toPosixPath(value: string) {
  return value.split(path.sep).join('/')
}

export function normalizeManifestDescription(meta: PluginSourceManifest) {
  return meta.description || meta.name
}

export function normalizeAuthorObject(name?: string, email?: string) {
  const authorName = name?.trim()
  if (!authorName) return undefined
  return email?.trim() ? { name: authorName, email: email.trim() } : { name: authorName }
}

export function pluginAuthor(meta: PluginSourceManifest, owner: PluginOwner) {
  return normalizeAuthorObject(meta.author ?? owner.name, owner.email)
}

export async function readPluginManifest(pluginSourceDir: string) {
  const manifestPath = path.join(pluginSourceDir, '.plugin', 'plugin.json')
  const raw = await readJsonFile<unknown>(manifestPath)
  if (!raw) {
    throw new Error(`Missing .plugin/plugin.json in ${pluginSourceDir}`)
  }
  const meta = pluginManifestSchema.safeParse(raw)
  if (!meta.success) {
    const issue = meta.error.issues[0]
    throw new Error(`Invalid .plugin/plugin.json in ${pluginSourceDir}: ${issue?.message ?? 'invalid data'}`)
  }
  return meta.data
}

export async function listPluginDirs(pluginsRoot: string, onlyPlugin?: string) {
  const explicitPluginDir = onlyPlugin ? path.join(pluginsRoot, onlyPlugin) : null
  if (explicitPluginDir) {
    if (!(await pathExists(explicitPluginDir))) {
      throw new Error(`Plugin not found: ${explicitPluginDir}`)
    }
    return [explicitPluginDir]
  }

  const entries = await fs.readdir(pluginsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsRoot, entry.name))
}

export async function detectPluginFeatures(pluginSourceDir: string): Promise<PluginFeatures> {
  const hasFile = (relativePath: string) => pathExists(path.join(pluginSourceDir, relativePath))

  return {
    hasReadme: await hasFile('README.md'),
    hasSkills: await hasFile('skills'),
    hasCommands: await hasFile('commands'),
    hasAgents: await hasFile('agents'),
    hasRules: await hasFile('rules'),
    hasHooks: await hasFile('hooks/hooks.json'),
    hasAssets: await hasFile('assets'),
    hasScripts: await hasFile('scripts'),
    hasSettings: await hasFile('settings.json'),
    hasClaudeMcp: (await hasFile('.mcp.json')) || (await hasFile('mcp.json')),
    hasClaudeLsp: await hasFile('.lsp.json'),
    hasCodexApp: await hasFile('.app.json'),
  }
}

export async function copyEntry(
  pluginSourceDir: string,
  pluginDir: string,
  sourceRel: string,
  destinationRel = sourceRel
) {
  const sourcePath = path.join(pluginSourceDir, sourceRel)
  if (!(await pathExists(sourcePath))) return false

  const destinationPath = path.join(pluginDir, destinationRel)
  await ensureDir(path.dirname(destinationPath))
  await fs.cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
  })
  return true
}

export async function copyEntries(pluginSourceDir: string, pluginDir: string, entries: CopyEntrySpec[]) {
  await Promise.all(
    entries.map((entry) =>
      typeof entry === 'string'
        ? copyEntry(pluginSourceDir, pluginDir, entry)
        : copyEntry(pluginSourceDir, pluginDir, entry.source, entry.destination)
    )
  )
}

export function resolveExportBaseOut(cwd: string, target: PluginProviderSelector, out?: string) {
  if (out) return path.resolve(cwd, out)
  if (target === 'all') return path.join(cwd, 'dist', 'plugins')
  return path.join(cwd, 'dist', `${target}-marketplace`)
}

export function resolveProviderOutRoot(
  baseOut: string,
  target: PluginProviderSelector,
  provider: PluginProviderId
) {
  return target === 'all' ? path.join(baseOut, provider) : baseOut
}

export async function loadPluginConfig(
  cwd: string,
  explicitConfigPath?: string,
  overrides?: Partial<PluginExportOptions>
) {
  const defaultNewConfigPath = path.join(cwd, 'agentrig.plugins.json')
  const configPath = explicitConfigPath
    ? path.resolve(cwd, explicitConfigPath)
    : (await pathExists(defaultNewConfigPath))
      ? defaultNewConfigPath
      : null

  const raw = configPath ? await readJsonFile<PluginConfigFile>(configPath) : null
  const parsedResult = pluginConfigFileSchema.safeParse(raw ?? {})
  if (!parsedResult.success) {
    const issue = parsedResult.error.issues[0]
    throw new Error(`Invalid plugin config: ${issue?.message ?? 'invalid data'}`)
  }
  const parsed = parsedResult.data

  const ownerName = overrides?.ownerName?.trim() || parsed.owner?.name?.trim() || DEFAULT_CONFIG.owner.name
  const ownerEmail = overrides?.ownerEmail?.trim() || parsed.owner?.email?.trim() || DEFAULT_CONFIG.owner.email

  return {
    pluginPrefix:
      overrides?.pluginPrefix?.trim() || parsed.pluginPrefix?.trim() || DEFAULT_CONFIG.pluginPrefix,
    owner: {
      name: ownerName,
      ...(ownerEmail ? { email: ownerEmail } : {}),
    },
    providers: {
      claude: {
        marketplaceName:
          overrides?.marketplaceName?.trim() ||
          parsed.providers?.claude?.marketplaceName?.trim() ||
          DEFAULT_CONFIG.providers.claude.marketplaceName,
        metadata: {
          description:
            parsed.providers?.claude?.metadata?.description?.trim() ||
            DEFAULT_CONFIG.providers.claude.metadata.description,
          version:
            parsed.providers?.claude?.metadata?.version?.trim() ||
            DEFAULT_CONFIG.providers.claude.metadata.version,
          pluginRoot:
            parsed.providers?.claude?.metadata?.pluginRoot?.trim() ||
            DEFAULT_CONFIG.providers.claude.metadata.pluginRoot,
        },
      },
      codex: {
        marketplaceName:
          overrides?.marketplaceName?.trim() ||
          parsed.providers?.codex?.marketplaceName?.trim() ||
          DEFAULT_CONFIG.providers.codex.marketplaceName,
        displayName:
          parsed.providers?.codex?.displayName?.trim() ||
          DEFAULT_CONFIG.providers.codex.displayName,
        category:
          parsed.providers?.codex?.category?.trim() ||
          DEFAULT_CONFIG.providers.codex.category,
        installationPolicy:
          parsed.providers?.codex?.installationPolicy ||
          DEFAULT_CONFIG.providers.codex.installationPolicy,
        authenticationPolicy:
          parsed.providers?.codex?.authenticationPolicy ||
          DEFAULT_CONFIG.providers.codex.authenticationPolicy,
        pluginRoot:
          parsed.providers?.codex?.pluginRoot?.trim() ||
          DEFAULT_CONFIG.providers.codex.pluginRoot,
      },
      cursor: {
        marketplaceName:
          overrides?.marketplaceName?.trim() ||
          parsed.providers?.cursor?.marketplaceName?.trim() ||
          DEFAULT_CONFIG.providers.cursor.marketplaceName,
        metadata: {
          description:
            parsed.providers?.cursor?.metadata?.description?.trim() ||
            DEFAULT_CONFIG.providers.cursor.metadata.description,
          version:
            parsed.providers?.cursor?.metadata?.version?.trim() ||
            DEFAULT_CONFIG.providers.cursor.metadata.version,
          pluginRoot:
            parsed.providers?.cursor?.metadata?.pluginRoot?.trim() ||
            DEFAULT_CONFIG.providers.cursor.metadata.pluginRoot,
        },
      },
    },
  } satisfies ResolvedPluginConfig
}

export async function buildPluginEntries(
  pluginsRoot: string,
  pluginPrefix: string,
  onlyPlugin?: string
): Promise<PluginEntry[]> {
  const pluginDirs = await listPluginDirs(pluginsRoot, onlyPlugin)
  const plugins = await Promise.all(
    pluginDirs.map(async (pluginSourceDir) => {
      const manifest = await readPluginManifest(pluginSourceDir)
      return {
        manifest,
        pluginSourceDir,
        pluginName: `${pluginPrefix}${manifest.id}`,
      } satisfies PluginEntry
    })
  )
  return plugins.sort((left, right) => left.pluginName.localeCompare(right.pluginName))
}

async function walkFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const nextPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(rootDir, nextPath)))
      continue
    }
    if (entry.isFile()) {
      files.push(path.relative(rootDir, nextPath))
    }
  }

  return files.sort()
}

export async function copyInstalledPlugin(
  sourceDir: string,
  destinationDir: string,
  force: boolean
): Promise<{ changed: boolean; files: PluginInstalledFile[] }> {
  const exists = await pathExists(destinationDir)
  if (exists && !force) {
    return { changed: false, files: [] }
  }

  const relativeFiles = await walkFiles(sourceDir)
  const destinationParent = path.dirname(destinationDir)
  const destinationBase = path.basename(destinationDir)
  await ensureDir(destinationParent)
  const stagingDir = await fs.mkdtemp(path.join(destinationParent, `${destinationBase}.staging-`))

  const files: PluginInstalledFile[] = []
  try {
    for (const relativeFile of relativeFiles) {
      const sourcePath = path.join(sourceDir, relativeFile)
      const destinationPath = path.join(stagingDir, relativeFile)
      const bytes = await fs.readFile(sourcePath)
      await ensureDir(path.dirname(destinationPath))
      await fs.writeFile(destinationPath, bytes)
      files.push({
        path: path.join(destinationDir, relativeFile),
        sha256: sha256Hex(bytes),
      })
    }

    const backupDir = exists
      ? path.join(destinationParent, `${destinationBase}.backup-${randomUUID()}`)
      : null
    if (backupDir) {
      await fs.rename(destinationDir, backupDir)
    }

    try {
      await fs.rename(stagingDir, destinationDir)
    } catch (error) {
      if (backupDir && !(await pathExists(destinationDir))) {
        await fs.rename(backupDir, destinationDir).catch(() => {})
      }
      throw error
    }

    if (backupDir) {
      await fs.rm(backupDir, { recursive: true, force: true })
    }
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    changed: true,
    files,
  }
}

async function pruneEmptyDirectories(rootDir: string, filePaths: string[], dryRun: boolean) {
  const candidateDirs = new Set<string>()
  for (const filePath of filePaths) {
    let currentDir = path.dirname(filePath)
    while (currentDir.startsWith(rootDir)) {
      candidateDirs.add(currentDir)
      if (currentDir === rootDir) break
      currentDir = path.dirname(currentDir)
    }
  }

  const orderedDirs = [...candidateDirs].sort((left, right) => right.length - left.length)
  for (const directory of orderedDirs) {
    if (!(await pathExists(directory))) continue
    const contents = await fs.readdir(directory)
    if (contents.length > 0) continue
    if (!dryRun) {
      await fs.rmdir(directory)
    }
  }
}

export async function removeInstalledFiles(
  rootDir: string,
  files: PluginInstalledFile[],
  dryRun: boolean
): Promise<FileRemovalSummary> {
  const removed: string[] = []
  const kept: string[] = []
  const missing: string[] = []

  for (const file of files) {
    if (!(await pathExists(file.path))) {
      missing.push(file.path)
      continue
    }

    const buf = await fs.readFile(file.path)
    const actual = sha256Hex(buf)
    if (actual !== file.sha256) {
      kept.push(file.path)
      continue
    }

    if (!dryRun) {
      await fs.rm(file.path, { force: true })
    }
    removed.push(file.path)
  }

  if (kept.length === 0) {
    await pruneEmptyDirectories(rootDir, files.map((file) => file.path), dryRun)
  }

  return { removed, kept, missing }
}

export async function defaultCommandRunner(command: string, args: string[]) {
  try {
    await execFile(command, args, {
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr || '').trim()
        : ''
    throw new Error(message || `Command failed: ${command} ${args.join(' ')}`)
  }
}

export function parsePluginProviderSelector(value?: string): PluginProviderSelector {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    throw new Error('Provider must be specified.')
  }
  const parsed = pluginProviderSelectorSchema.safeParse(normalized)
  if (parsed.success) return parsed.data
  throw new Error(`Unsupported provider: ${value}`)
}

export function parsePluginInstallScopeSelector(value?: string): PluginInstallScopeSelector {
  const normalized = value?.trim().toLowerCase() || 'auto'
  const parsed = pluginInstallScopeSelectorSchema.safeParse(normalized)
  if (parsed.success) return parsed.data
  throw new Error(`Unsupported scope: ${value}`)
}

export function parsePluginInstallScope(value?: string): PluginInstallScope {
  const normalized = value?.trim().toLowerCase() || 'workspace'
  const parsed = pluginInstallScopeSchema.safeParse(normalized)
  if (parsed.success) return parsed.data
  throw new Error(`Unsupported scope: ${value}`)
}

export function formatProviderSummary(result: ProviderExportResult) {
  return `${result.provider}: ${result.plugins.length} plugin(s) -> ${toPosixPath(result.outRoot)}`
}
