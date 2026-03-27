import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureDir, pathExists, readJsonFile, removeIfExists, writeJsonFile } from './fs'
import type { PackMeta } from './types'

const execFile = promisify(execFileCallback)

export const PLUGIN_PROVIDER_IDS = ['claude', 'codex', 'cursor'] as const

export type PluginProviderId = (typeof PLUGIN_PROVIDER_IDS)[number]
export type PluginProviderSelector = PluginProviderId | 'all'
export type PluginInstallScope = 'personal' | 'workspace'

type PluginOwner = {
  name: string
  email?: string
}

type ClaudeMarketplaceConfig = {
  marketplaceName?: string
  metadata?: {
    description?: string
    version?: string
    pluginRoot?: string
  }
}

type CodexMarketplaceConfig = {
  marketplaceName?: string
  displayName?: string
  category?: string
  installationPolicy?: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE'
  authenticationPolicy?: 'ON_INSTALL' | 'ON_FIRST_USE'
  pluginRoot?: string
}

type CursorMarketplaceConfig = {
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

type ResolvedPluginConfig = {
  pluginPrefix: string
  owner: PluginOwner
  providers: {
    claude: Required<ClaudeMarketplaceConfig>
    codex: Required<CodexMarketplaceConfig>
    cursor: Required<CursorMarketplaceConfig>
  }
}

type PackEntry = {
  meta: PackMeta
  packDir: string
  pluginName: string
}

type PackFeatures = {
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

export type ProviderInstallResult = {
  provider: PluginProviderId
  installed: string[]
  skipped: string[]
  locations: string[]
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
  scope?: PluginInstallScope
  force?: boolean
  dryRun?: boolean
  commandRunner?: ExternalCommandRunner
}

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

function isPluginProviderId(value: string): value is PluginProviderId {
  return (PLUGIN_PROVIDER_IDS as readonly string[]).includes(value)
}

export function resolvePluginProviders(target: PluginProviderSelector) {
  if (target === 'all') return [...PLUGIN_PROVIDER_IDS]
  return [target]
}

function toPosixPath(value: string) {
  return value.split(path.sep).join('/')
}

function normalizeManifestDescription(meta: PackMeta) {
  return meta.description || meta.title
}

function normalizeAuthorObject(name?: string, email?: string) {
  const authorName = name?.trim()
  if (!authorName) return undefined
  return email?.trim() ? { name: authorName, email: email.trim() } : { name: authorName }
}

function pluginAuthor(meta: PackMeta, owner: PluginOwner) {
  return normalizeAuthorObject(meta.author ?? owner.name, owner.email)
}

async function readPackMeta(packDir: string) {
  const metaPath = path.join(packDir, 'meta.json')
  const meta = await readJsonFile<PackMeta>(metaPath)
  if (!meta) {
    throw new Error(`Missing meta.json in ${packDir}`)
  }
  if (!meta.name || !meta.title || !meta.description || !meta.version) {
    throw new Error(`Invalid meta.json in ${packDir}`)
  }
  return meta
}

async function listPackDirs(packsRoot: string, onlyPack?: string) {
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

async function detectPackFeatures(packDir: string): Promise<PackFeatures> {
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

async function copyEntry(packDir: string, pluginDir: string, sourceRel: string, destinationRel = sourceRel) {
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

async function copyClaudePlugin(packDir: string, pluginDir: string) {
  await Promise.all([
    copyEntry(packDir, pluginDir, 'skills'),
    copyEntry(packDir, pluginDir, 'commands'),
    copyEntry(packDir, pluginDir, 'agents'),
    copyEntry(packDir, pluginDir, 'hooks'),
    copyEntry(packDir, pluginDir, 'assets'),
    copyEntry(packDir, pluginDir, 'scripts'),
    copyEntry(packDir, pluginDir, 'README.md'),
    copyEntry(packDir, pluginDir, 'settings.json'),
    copyEntry(packDir, pluginDir, '.mcp.json'),
    copyEntry(packDir, pluginDir, 'mcp.json', '.mcp.json'),
    copyEntry(packDir, pluginDir, '.lsp.json'),
  ])
}

async function copyCodexPlugin(packDir: string, pluginDir: string) {
  await Promise.all([
    copyEntry(packDir, pluginDir, 'skills'),
    copyEntry(packDir, pluginDir, 'assets'),
    copyEntry(packDir, pluginDir, 'README.md'),
    copyEntry(packDir, pluginDir, '.mcp.json'),
    copyEntry(packDir, pluginDir, 'mcp.json', '.mcp.json'),
    copyEntry(packDir, pluginDir, '.app.json'),
  ])
}

async function copyCursorPlugin(packDir: string, pluginDir: string) {
  await Promise.all([
    copyEntry(packDir, pluginDir, 'rules'),
    copyEntry(packDir, pluginDir, 'skills'),
    copyEntry(packDir, pluginDir, 'agents'),
    copyEntry(packDir, pluginDir, 'commands'),
    copyEntry(packDir, pluginDir, 'hooks'),
    copyEntry(packDir, pluginDir, 'assets'),
    copyEntry(packDir, pluginDir, 'scripts'),
    copyEntry(packDir, pluginDir, 'README.md'),
    copyEntry(packDir, pluginDir, '.mcp.json', 'mcp.json'),
    copyEntry(packDir, pluginDir, 'mcp.json'),
  ])
}

function buildClaudePluginManifest(pack: PackEntry, owner: PluginOwner, features: PackFeatures) {
  return {
    name: pack.pluginName,
    description: normalizeManifestDescription(pack.meta),
    version: pack.meta.version,
    ...(pluginAuthor(pack.meta, owner) ? { author: pluginAuthor(pack.meta, owner) } : {}),
    ...(features.hasCommands ? { commands: ['./commands'] } : {}),
    ...(features.hasAgents ? { agents: ['./agents'] } : {}),
  }
}

function buildCodexPluginManifest(pack: PackEntry, owner: PluginOwner, features: PackFeatures) {
  return {
    name: pack.pluginName,
    version: pack.meta.version,
    description: normalizeManifestDescription(pack.meta),
    ...(pluginAuthor(pack.meta, owner) ? { author: pluginAuthor(pack.meta, owner) } : {}),
    ...(features.hasSkills ? { skills: './skills/' } : {}),
    ...(features.hasClaudeMcp ? { mcpServers: './.mcp.json' } : {}),
    ...(features.hasCodexApp ? { apps: './.app.json' } : {}),
    interface: {
      displayName: pack.meta.title,
      shortDescription: normalizeManifestDescription(pack.meta),
      developerName: pack.meta.author ?? owner.name,
      category: 'Productivity',
    },
  }
}

function buildCursorPluginManifest(pack: PackEntry, owner: PluginOwner, features: PackFeatures) {
  return {
    name: pack.pluginName,
    description: normalizeManifestDescription(pack.meta),
    version: pack.meta.version,
    ...(pluginAuthor(pack.meta, owner) ? { author: pluginAuthor(pack.meta, owner) } : {}),
    ...(features.hasRules ? { rules: './rules' } : {}),
    ...(features.hasSkills ? { skills: './skills' } : {}),
    ...(features.hasAgents ? { agents: './agents' } : {}),
    ...(features.hasCommands ? { commands: './commands' } : {}),
    ...(features.hasHooks ? { hooks: './hooks/hooks.json' } : {}),
    ...(features.hasClaudeMcp ? { mcpServers: './mcp.json' } : {}),
  }
}

function buildClaudeMarketplaceManifest(
  cfg: ResolvedPluginConfig,
  packs: PackEntry[],
  marketplaceNameOverride?: string
) {
  return {
    name: marketplaceNameOverride ?? cfg.providers.claude.marketplaceName,
    owner: {
      name: cfg.owner.name,
      ...(cfg.owner.email ? { email: cfg.owner.email } : {}),
    },
    metadata: cfg.providers.claude.metadata,
    plugins: packs.map((pack) => ({
      name: pack.pluginName,
      source: pack.pluginName,
      description: pack.meta.description,
      version: pack.meta.version,
      tags: pack.meta.tags,
    })),
  }
}

function buildCodexMarketplaceManifest(
  cfg: ResolvedPluginConfig,
  packs: PackEntry[],
  marketplaceNameOverride?: string
) {
  return {
    name: marketplaceNameOverride ?? cfg.providers.codex.marketplaceName,
    interface: {
      displayName: cfg.providers.codex.displayName,
    },
    plugins: packs.map((pack) => ({
      name: pack.pluginName,
      source: {
        source: 'local',
        path: `${cfg.providers.codex.pluginRoot}/${pack.pluginName}`,
      },
      policy: {
        installation: cfg.providers.codex.installationPolicy,
        authentication: cfg.providers.codex.authenticationPolicy,
      },
      category: cfg.providers.codex.category,
    })),
  }
}

function buildCursorMarketplaceManifest(
  cfg: ResolvedPluginConfig,
  packs: PackEntry[],
  marketplaceNameOverride?: string
) {
  return {
    name: marketplaceNameOverride ?? cfg.providers.cursor.marketplaceName,
    owner: {
      name: cfg.owner.name,
      ...(cfg.owner.email ? { email: cfg.owner.email } : {}),
    },
    metadata: {
      description: cfg.providers.cursor.metadata.description,
      version: cfg.providers.cursor.metadata.version,
      pluginRoot: cfg.providers.cursor.metadata.pluginRoot,
    },
    plugins: packs.map((pack) => ({
      name: pack.pluginName,
      source: `${cfg.providers.cursor.metadata.pluginRoot}/${pack.pluginName}`,
      description: pack.meta.description,
      version: pack.meta.version,
      ...(pluginAuthor(pack.meta, cfg.owner) ? { author: pluginAuthor(pack.meta, cfg.owner) } : {}),
      keywords: pack.meta.tags,
    })),
  }
}

function resolveExportBaseOut(cwd: string, target: PluginProviderSelector, out?: string) {
  if (out) return path.resolve(cwd, out)
  if (target === 'all') return path.join(cwd, 'dist', 'plugins')
  return path.join(cwd, 'dist', `${target}-marketplace`)
}

function resolveProviderOutRoot(baseOut: string, target: PluginProviderSelector, provider: PluginProviderId) {
  return target === 'all' ? path.join(baseOut, provider) : baseOut
}

async function loadPluginConfig(cwd: string, explicitConfigPath?: string, overrides?: Partial<PluginExportOptions>) {
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
  const parsed = raw ?? {}

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

async function buildPackEntries(
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

async function exportClaudeProvider(
  outRoot: string,
  cfg: ResolvedPluginConfig,
  packs: PackEntry[]
): Promise<ProviderExportResult> {
  const pluginRoot = path.join(outRoot, 'plugins')
  await ensureDir(pluginRoot)
  await ensureDir(path.join(outRoot, '.claude-plugin'))

  for (const pack of packs) {
    const pluginDir = path.join(pluginRoot, pack.pluginName)
    await copyClaudePlugin(pack.packDir, pluginDir)
    const features = await detectPackFeatures(pluginDir)
    await writeJsonFile(
      path.join(pluginDir, '.claude-plugin', 'plugin.json'),
      buildClaudePluginManifest(pack, cfg.owner, features)
    )
  }

  await writeJsonFile(
    path.join(outRoot, '.claude-plugin', 'marketplace.json'),
    buildClaudeMarketplaceManifest(cfg, packs)
  )

  return {
    provider: 'claude',
    outRoot,
    marketplaceName: cfg.providers.claude.marketplaceName,
    plugins: packs,
  }
}

async function exportCodexProvider(
  outRoot: string,
  cfg: ResolvedPluginConfig,
  packs: PackEntry[]
): Promise<ProviderExportResult> {
  const pluginRoot = path.join(outRoot, 'plugins')
  const marketplacePath = path.join(outRoot, '.agents', 'plugins', 'marketplace.json')
  await ensureDir(pluginRoot)
  await ensureDir(path.dirname(marketplacePath))

  for (const pack of packs) {
    const pluginDir = path.join(pluginRoot, pack.pluginName)
    await copyCodexPlugin(pack.packDir, pluginDir)
    const features = await detectPackFeatures(pluginDir)
    await writeJsonFile(
      path.join(pluginDir, '.codex-plugin', 'plugin.json'),
      buildCodexPluginManifest(pack, cfg.owner, features)
    )
  }

  await writeJsonFile(marketplacePath, buildCodexMarketplaceManifest(cfg, packs))

  return {
    provider: 'codex',
    outRoot,
    marketplaceName: cfg.providers.codex.marketplaceName,
    plugins: packs,
  }
}

async function exportCursorProvider(
  outRoot: string,
  cfg: ResolvedPluginConfig,
  packs: PackEntry[]
): Promise<ProviderExportResult> {
  const pluginRoot = path.join(outRoot, 'plugins')
  const marketplacePath = path.join(outRoot, '.cursor-plugin', 'marketplace.json')
  await ensureDir(pluginRoot)
  await ensureDir(path.dirname(marketplacePath))

  for (const pack of packs) {
    const pluginDir = path.join(pluginRoot, pack.pluginName)
    await copyCursorPlugin(pack.packDir, pluginDir)
    const features = await detectPackFeatures(pluginDir)
    await writeJsonFile(
      path.join(pluginDir, '.cursor-plugin', 'plugin.json'),
      buildCursorPluginManifest(pack, cfg.owner, features)
    )
  }

  await writeJsonFile(marketplacePath, buildCursorMarketplaceManifest(cfg, packs))

  return {
    provider: 'cursor',
    outRoot,
    marketplaceName: cfg.providers.cursor.marketplaceName,
    plugins: packs,
  }
}

export async function exportPluginProviders(options: PluginExportOptions): Promise<ProviderExportResult[]> {
  const providers = resolvePluginProviders(options.agent)
  const baseOut = resolveExportBaseOut(options.cwd, options.agent, options.out)
  const packsRoot = path.resolve(options.cwd, options.packsDir)
  const cfg = await loadPluginConfig(options.cwd, options.configPath, options)

  if (!(await pathExists(packsRoot))) {
    throw new Error(`Missing packs directory: ${packsRoot}`)
  }

  if (options.clean) {
    await removeIfExists(baseOut)
  }

  const packs = await buildPackEntries(packsRoot, cfg.pluginPrefix, options.pack)
  const results: ProviderExportResult[] = []

  for (const provider of providers) {
    const providerOut = resolveProviderOutRoot(baseOut, options.agent, provider)
    if (provider === 'claude') {
      results.push(await exportClaudeProvider(providerOut, cfg, packs))
      continue
    }
    if (provider === 'codex') {
      results.push(await exportCodexProvider(providerOut, cfg, packs))
      continue
    }
    results.push(await exportCursorProvider(providerOut, cfg, packs))
  }

  return results
}

async function defaultCommandRunner(command: string, args: string[]) {
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

async function installClaudeProvider(
  result: ProviderExportResult,
  dryRun: boolean,
  runner: ExternalCommandRunner
): Promise<ProviderInstallResult> {
  const installed: string[] = []
  const skipped: string[] = []
  const locations = [result.outRoot]

  if (dryRun) {
    return {
      provider: 'claude',
      installed: result.plugins.map((plugin) => plugin.pluginName),
      skipped,
      locations,
    }
  }

  try {
    await runner('claude', ['plugin', 'marketplace', 'add', result.outRoot])
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    if (!message.includes('already')) {
      throw error
    }
  }

  for (const plugin of result.plugins) {
    await runner('claude', ['plugin', 'install', `${plugin.pluginName}@${result.marketplaceName}`])
    installed.push(plugin.pluginName)
  }

  return {
    provider: 'claude',
    installed,
    skipped,
    locations,
  }
}

function resolveCodexInstallPaths(cwd: string, scope: PluginInstallScope) {
  if (scope === 'workspace') {
    return {
      root: cwd,
      pluginRoot: path.join(cwd, 'plugins'),
      marketplacePath: path.join(cwd, '.agents', 'plugins', 'marketplace.json'),
      relativePluginRoot: './plugins',
    }
  }

  const home = homedir()
  return {
    root: home,
    pluginRoot: path.join(home, '.codex', 'plugins'),
    marketplacePath: path.join(home, '.agents', 'plugins', 'marketplace.json'),
    relativePluginRoot: './.codex/plugins',
  }
}

async function copyInstalledPlugin(sourceDir: string, destinationDir: string, force: boolean) {
  const exists = await pathExists(destinationDir)
  if (exists && !force) {
    return false
  }

  if (exists && force) {
    await removeIfExists(destinationDir)
  }

  await ensureDir(path.dirname(destinationDir))
  await fs.cp(sourceDir, destinationDir, {
    recursive: true,
    force: true,
  })
  return true
}

async function installCodexProvider(
  cwd: string,
  result: ProviderExportResult,
  cfg: ResolvedPluginConfig,
  scope: PluginInstallScope,
  force: boolean,
  dryRun: boolean
): Promise<ProviderInstallResult> {
  const installed: string[] = []
  const skipped: string[] = []
  const { pluginRoot, marketplacePath, relativePluginRoot } = resolveCodexInstallPaths(cwd, scope)
  const pluginSourceRoot = path.join(result.outRoot, 'plugins')

  const marketplace =
    (await readJsonFile<Record<string, unknown>>(marketplacePath)) ?? buildCodexMarketplaceManifest(cfg, [])

  const existingPlugins = Array.isArray(marketplace.plugins)
    ? [...marketplace.plugins]
    : []

  for (const pack of result.plugins) {
    const sourceDir = path.join(pluginSourceRoot, pack.pluginName)
    const destinationDir = path.join(pluginRoot, pack.pluginName)
    const changed = dryRun ? true : await copyInstalledPlugin(sourceDir, destinationDir, force)
    if (changed) {
      installed.push(pack.pluginName)
    } else {
      skipped.push(pack.pluginName)
    }

    const entry = {
      name: pack.pluginName,
      source: {
        source: 'local',
        path: `${relativePluginRoot}/${pack.pluginName}`,
      },
      policy: {
        installation: cfg.providers.codex.installationPolicy,
        authentication: cfg.providers.codex.authenticationPolicy,
      },
      category: cfg.providers.codex.category,
    }

    const index = existingPlugins.findIndex((item) => {
      return Boolean(item) && typeof item === 'object' && (item as { name?: string }).name === pack.pluginName
    })
    if (index >= 0) {
      existingPlugins[index] = entry
    } else {
      existingPlugins.push(entry)
    }
  }

  if (!dryRun) {
    await writeJsonFile(marketplacePath, {
      name:
        typeof marketplace.name === 'string' && marketplace.name.trim()
          ? marketplace.name
          : cfg.providers.codex.marketplaceName,
      interface:
        marketplace.interface && typeof marketplace.interface === 'object'
          ? marketplace.interface
          : { displayName: cfg.providers.codex.displayName },
      plugins: existingPlugins,
    })
  }

  return {
    provider: 'codex',
    installed,
    skipped,
    locations: [pluginRoot, marketplacePath],
  }
}

async function installCursorProvider(
  result: ProviderExportResult,
  scope: PluginInstallScope,
  force: boolean,
  dryRun: boolean
): Promise<ProviderInstallResult> {
  if (scope !== 'personal') {
    throw new Error('Cursor local installs currently support only --scope personal')
  }

  const installed: string[] = []
  const skipped: string[] = []
  const pluginRoot = path.join(homedir(), '.cursor', 'plugins', 'local')
  const pluginSourceRoot = path.join(result.outRoot, 'plugins')

  for (const pack of result.plugins) {
    const sourceDir = path.join(pluginSourceRoot, pack.pluginName)
    const destinationDir = path.join(pluginRoot, pack.pluginName)
    const changed = dryRun ? true : await copyInstalledPlugin(sourceDir, destinationDir, force)
    if (changed) {
      installed.push(pack.pluginName)
    } else {
      skipped.push(pack.pluginName)
    }
  }

  return {
    provider: 'cursor',
    installed,
    skipped,
    locations: [pluginRoot],
  }
}

export async function installPluginProviders(options: PluginInstallOptions): Promise<ProviderInstallResult[]> {
  const cfg = await loadPluginConfig(options.cwd, options.configPath, options)
  const baseOut = options.out
    ? path.resolve(options.cwd, options.out)
    : await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugins-'))

  const dryRun = Boolean(options.dryRun)
  const force = Boolean(options.force)
  const scope = options.scope ?? 'personal'
  const commandRunner = options.commandRunner ?? defaultCommandRunner

  try {
    const exportResults = await exportPluginProviders({
      ...options,
      out: baseOut,
      clean: options.out ? options.clean : true,
    })

    const installs: ProviderInstallResult[] = []
    for (const result of exportResults) {
      if (result.provider === 'claude') {
        installs.push(await installClaudeProvider(result, dryRun, commandRunner))
        continue
      }
      if (result.provider === 'codex') {
        installs.push(
          await installCodexProvider(options.cwd, result, cfg, scope, force, dryRun)
        )
        continue
      }
      installs.push(await installCursorProvider(result, scope, force, dryRun))
    }
    return installs
  } finally {
    if (!options.out) {
      await removeIfExists(baseOut)
    }
  }
}

export function parsePluginProviderSelector(value?: string): PluginProviderSelector {
  const normalized = value?.trim().toLowerCase() || 'all'
  if (normalized === 'all') return 'all'
  if (isPluginProviderId(normalized)) return normalized
  throw new Error(`Unsupported provider: ${value}`)
}

export function formatProviderSummary(result: ProviderExportResult) {
  return `${result.provider}: ${result.plugins.length} plugin(s) -> ${toPosixPath(result.outRoot)}`
}
