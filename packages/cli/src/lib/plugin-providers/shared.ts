import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { ensureDir, pathExists, readJsonFile } from '../fs'
import { sha256Hex } from '../hash'
import { isValidPackName, isValidPackVersion } from '../pack-validation'
import type {
  PluginInstallRecord,
  PluginInstalledFile,
  PluginInstallScopeSelectorName,
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
  name?: string
  metadata?: ClaudeMarketplaceConfig['metadata']
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

export type PluginPackMeta = z.infer<typeof pluginPackMetaSchema>

export type PackEntry = {
  meta: PluginPackMeta
  packDir: string
  pluginName: string
}

export type PackFeatures = {
  hasReadme: boolean
  hasSkills: boolean
  hasCommands: boolean
  hasAgents: boolean
  hasRules: boolean
  hasHooks: boolean
  hasAssets: boolean
  hasScripts: boolean
  hasSettings: boolean
  hasClaudeMcp: boolean
  hasClaudeLsp: boolean
  hasCodexApp: boolean
}

export type ProviderExportResult = {
  provider: PluginProviderId
  outRoot: string
  marketplaceName: string
  plugins: PackEntry[]
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
  packsDir: string
  out?: string
  configPath?: string
  marketplaceName?: string
  ownerName?: string
  ownerEmail?: string
  pluginPrefix?: string
  clean?: boolean
  pack?: string
}

export type ExternalCommandRunner = (command: string, args: string[]) => Promise<void>

export type PluginInstallOptions = PluginExportOptions & {
  scope?: PluginInstallScopeSelector
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
  packsRoot: string
  packs: PackEntry[]
  baseOut: string
  out?: string
  clean: boolean
  force: boolean
  dryRun: boolean
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
  packs: PackEntry[]
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
  packs: PackEntry[]
}

export type ProviderInstallContext = {
  cwd: string
  result: ProviderExportResult
  cfg: ResolvedPluginConfig
  scope: PluginInstallScope
  requestedScope: PluginInstallScopeSelector
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
const pluginMetadataSchema = z.looseObject({
  description: optionalStringSchema,
  version: optionalStringSchema,
  pluginRoot: optionalStringSchema,
})
const pluginOwnerSchema = z.looseObject({
  name: optionalStringSchema,
  email: optionalStringSchema,
})
const claudeMarketplaceConfigSchema = z.looseObject({
  marketplaceName: optionalStringSchema,
  metadata: pluginMetadataSchema.optional(),
})
const codexMarketplaceConfigSchema = z.looseObject({
  marketplaceName: optionalStringSchema,
  displayName: optionalStringSchema,
  category: optionalStringSchema,
  installationPolicy: z.enum(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE']).optional(),
  authenticationPolicy: z.enum(['ON_INSTALL', 'ON_FIRST_USE']).optional(),
  pluginRoot: optionalStringSchema,
})
const cursorMarketplaceConfigSchema = z.looseObject({
  marketplaceName: optionalStringSchema,
  metadata: pluginMetadataSchema.optional(),
})
const pluginConfigFileSchema = z.looseObject({
  pluginPrefix: optionalStringSchema,
  owner: pluginOwnerSchema.optional(),
  providers: z
    .looseObject({
      claude: claudeMarketplaceConfigSchema.optional(),
      codex: codexMarketplaceConfigSchema.optional(),
      cursor: cursorMarketplaceConfigSchema.optional(),
    })
    .optional(),
  name: optionalStringSchema,
  metadata: pluginMetadataSchema.optional(),
})
const pluginPackMetaSchema = z.looseObject({
  name: nonEmptyStringSchema.refine(isValidPackName, 'Pack name must be lowercase letters, numbers, or hyphens'),
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  version: nonEmptyStringSchema.refine(isValidPackVersion, 'Pack version must be valid semver (x.y.z)'),
  author: optionalStringSchema,
  tags: z.array(nonEmptyStringSchema).optional(),
})

const DEFAULT_CONFIG: ResolvedPluginConfig = {
  pluginPrefix: 'agentrig-',
  owner: {
    name: 'Agentrig',
  },
  providers: {
    claude: {
      marketplaceName: 'agentrig-community',
      metadata: {
        description: 'Agentrig packs exported as Claude Code plugins.',
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
        description: 'Agentrig packs exported as Cursor plugins.',
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

export function normalizeManifestDescription(meta: PluginPackMeta) {
  return meta.description || meta.title
}

export function normalizeAuthorObject(name?: string, email?: string) {
  const authorName = name?.trim()
  if (!authorName) return undefined
  return email?.trim() ? { name: authorName, email: email.trim() } : { name: authorName }
}

export function pluginAuthor(meta: PluginPackMeta, owner: PluginOwner) {
  return normalizeAuthorObject(meta.author ?? owner.name, owner.email)
}

export async function readPackMeta(packDir: string) {
  const metaPath = path.join(packDir, 'meta.json')
  const raw = await readJsonFile<unknown>(metaPath)
  if (!raw) {
    throw new Error(`Missing meta.json in ${packDir}`)
  }
  const meta = pluginPackMetaSchema.safeParse(raw)
  if (!meta.success) {
    const issue = meta.error.issues[0]
    throw new Error(`Invalid meta.json in ${packDir}: ${issue?.message ?? 'invalid data'}`)
  }
  return meta.data
}

export async function listPackDirs(packsRoot: string, onlyPack?: string) {
  const explicitPackDir = onlyPack ? path.join(packsRoot, onlyPack) : null
  if (explicitPackDir) {
    if (!(await pathExists(explicitPackDir))) {
      throw new Error(`Pack not found: ${explicitPackDir}`)
    }
    return [explicitPackDir]
  }

  const entries = await fs.readdir(packsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packsRoot, entry.name))
}

export async function detectPackFeatures(packDir: string): Promise<PackFeatures> {
  const hasFile = (relativePath: string) => pathExists(path.join(packDir, relativePath))

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
  packDir: string,
  pluginDir: string,
  sourceRel: string,
  destinationRel = sourceRel
) {
  const sourcePath = path.join(packDir, sourceRel)
  if (!(await pathExists(sourcePath))) return false

  const destinationPath = path.join(pluginDir, destinationRel)
  await ensureDir(path.dirname(destinationPath))
  await fs.cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
  })
  return true
}

export async function copyEntries(packDir: string, pluginDir: string, entries: CopyEntrySpec[]) {
  await Promise.all(
    entries.map((entry) =>
      typeof entry === 'string'
        ? copyEntry(packDir, pluginDir, entry)
        : copyEntry(packDir, pluginDir, entry.source, entry.destination)
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
  const defaultLegacyConfigPath = path.join(cwd, 'agentrig.marketplace.json')
  const configPath = explicitConfigPath
    ? path.resolve(cwd, explicitConfigPath)
    : (await pathExists(defaultNewConfigPath))
      ? defaultNewConfigPath
      : (await pathExists(defaultLegacyConfigPath))
        ? defaultLegacyConfigPath
        : null

  const raw = configPath ? await readJsonFile<PluginConfigFile>(configPath) : null
  const parsedResult = pluginConfigFileSchema.safeParse(raw ?? {})
  if (!parsedResult.success) {
    const issue = parsedResult.error.issues[0]
    throw new Error(`Invalid plugin config: ${issue?.message ?? 'invalid data'}`)
  }
  const parsed = parsedResult.data

  const claudeFromLegacy =
    !parsed.providers && (parsed.name || parsed.metadata)
      ? {
          marketplaceName: parsed.name,
          metadata: parsed.metadata,
        }
      : undefined

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
          claudeFromLegacy?.marketplaceName?.trim() ||
          DEFAULT_CONFIG.providers.claude.marketplaceName,
        metadata: {
          description:
            parsed.providers?.claude?.metadata?.description?.trim() ||
            claudeFromLegacy?.metadata?.description?.trim() ||
            DEFAULT_CONFIG.providers.claude.metadata.description,
          version:
            parsed.providers?.claude?.metadata?.version?.trim() ||
            claudeFromLegacy?.metadata?.version?.trim() ||
            DEFAULT_CONFIG.providers.claude.metadata.version,
          pluginRoot:
            parsed.providers?.claude?.metadata?.pluginRoot?.trim() ||
            claudeFromLegacy?.metadata?.pluginRoot?.trim() ||
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

export async function buildPackEntries(
  packsRoot: string,
  pluginPrefix: string,
  onlyPack?: string
): Promise<PackEntry[]> {
  const packDirs = await listPackDirs(packsRoot, onlyPack)
  const packs = await Promise.all(
    packDirs.map(async (packDir) => {
      const meta = await readPackMeta(packDir)
      return {
        meta,
        packDir,
        pluginName: `${pluginPrefix}${meta.name}`,
      } satisfies PackEntry
    })
  )
  return packs.sort((left, right) => left.pluginName.localeCompare(right.pluginName))
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

  if (exists && force) {
    await fs.rm(destinationDir, { recursive: true, force: true })
  }

  const relativeFiles = await walkFiles(sourceDir)
  await ensureDir(destinationDir)

  const files: PluginInstalledFile[] = []
  for (const relativeFile of relativeFiles) {
    const sourcePath = path.join(sourceDir, relativeFile)
    const destinationPath = path.join(destinationDir, relativeFile)
    const bytes = await fs.readFile(sourcePath)
    await ensureDir(path.dirname(destinationPath))
    await fs.writeFile(destinationPath, bytes)
    files.push({
      path: destinationPath,
      sha256: sha256Hex(bytes),
    })
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
