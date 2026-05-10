import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ensureDir, pathExists, readJsonFile, removeIfExists, writeJsonFile } from '../fs'
import { getAgentRigHome, getCodexMarketplaceCacheRoot } from '../paths'
import { getPluginInstallRecordId, loadPluginInstallLedger } from '../plugin-install-ledger'
import { isSamePluginInstallSpecIdentity } from '../plugin-install-spec'
import type { CodexPluginInstallRecord } from '../types'
import { codexInstallPlugin, codexUninstallPlugin, type CodexInstallResult } from './codex-app-server'
import type {
  FileRemovalSummary,
  PluginEntry,
  PluginFeatures,
  PluginInstallScope,
  PluginOwner,
  PluginProviderAdapter,
  ProviderExportContext,
} from './shared'
import {
  codexMarketplaceManifestSchema,
  codexMarketplacePluginSchema,
  codexPluginManifestSchema,
  type CodexMarketplaceManifest,
  type CodexMarketplacePlugin,
  type CodexPluginManifest,
} from './schemas'
import {
  cleanEmptyAncestors,
  copyEntries,
  copyInstalledPlugin,
  detectPluginFeatures,
  assertContainedPath,
  normalizeManifestDescription,
  pluginAuthor,
  providerPluginName,
  removeInstalledFiles,
} from './shared'

async function copyCodexPlugin(pluginSourceDir: string, pluginDir: string) {
  await copyEntries(pluginSourceDir, pluginDir, [
    'skills',
    'assets',
    'README.md',
    '.mcp.json',
    { source: 'mcp.json', destination: '.mcp.json' },
    '.app.json',
  ])
}

function buildCodexPluginManifest(
  plugin: PluginEntry,
  owner: PluginOwner,
  features: PluginFeatures,
  pluginName: string
): CodexPluginManifest {
  return codexPluginManifestSchema.parse({
    name: pluginName,
    version: plugin.manifest.version,
    description: normalizeManifestDescription(plugin.manifest),
    ...(pluginAuthor(plugin.manifest, owner) ? { author: pluginAuthor(plugin.manifest, owner) } : {}),
    ...(features.hasSkills ? { skills: './skills/' } : {}),
    ...(features.hasClaudeMcp ? { mcpServers: './.mcp.json' } : {}),
    ...(features.hasCodexApp ? { apps: './.app.json' } : {}),
    interface: {
      displayName: plugin.manifest.name,
      shortDescription: normalizeManifestDescription(plugin.manifest),
      developerName: plugin.manifest.author ?? owner.name,
      category: 'Productivity',
    },
  })
}

function buildCodexMarketplaceManifest(
  cfg: ProviderExportContext['cfg'],
  plugins: ProviderExportContext['plugins'],
  pluginRoot = cfg.providers.codex.pluginRoot
): CodexMarketplaceManifest {
  return codexMarketplaceManifestSchema.parse({
    name: cfg.providers.codex.marketplaceName,
    interface: {
      displayName: cfg.providers.codex.displayName,
    },
    plugins: plugins.map((plugin) => {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      return {
        name: pluginName,
        source: {
          source: 'local',
          path: `${pluginRoot}/${pluginName}`,
        },
        policy: {
          installation: cfg.providers.codex.installationPolicy,
          authentication: cfg.providers.codex.authenticationPolicy,
        },
        category: cfg.providers.codex.category,
      }
    }),
  })
}

function resolveCodexInstallPaths(cwd: string, scope: PluginInstallScope) {
  if (scope === 'workspace') {
    return {
      pluginRoot: path.join(cwd, 'plugins'),
      marketplacePath: path.join(cwd, '.agents', 'plugins', 'marketplace.json'),
      relativePluginRoot: './plugins',
    }
  }

  const home = getAgentRigHome()
  return {
    pluginRoot: path.join(home, '.codex', 'plugins', 'cache'),
    marketplacePath: path.join(home, '.agents', 'plugins', 'marketplace.json'),
    relativePluginRoot: './.codex/plugins/cache',
  }
}

function resolveCodexPluginDestination(params: {
  pluginRoot: string
  relativePluginRoot: string
  scope: PluginInstallScope
  marketplaceName: string
  pluginName: string
  version: string
}) {
  if (params.scope === 'workspace') {
    return {
      destinationDir: path.join(params.pluginRoot, params.pluginName),
      marketplaceSourcePath: `${params.relativePluginRoot}/${params.pluginName}`,
    }
  }

  const pathSegments = [params.marketplaceName, params.pluginName, params.version]
  return {
    destinationDir: path.join(params.pluginRoot, ...pathSegments),
    marketplaceSourcePath: `${params.relativePluginRoot}/${pathSegments.join('/')}`,
  }
}

async function stageCodexMarketplaceForInstall(outRoot: string, marketplaceName: string) {
  const persistentRoot = getCodexMarketplaceCacheRoot(marketplaceName)
  await ensureDir(path.dirname(persistentRoot))
  const stagingParent = path.dirname(persistentRoot)
  const stagingDir = await fs.mkdtemp(path.join(stagingParent, `.${path.basename(persistentRoot)}.staging-`))
  let backupDir: string | undefined
  let backupPath: string | undefined

  try {
    await fs.cp(path.join(outRoot, 'plugins'), path.join(stagingDir, 'plugins'), { recursive: true, force: true })
    const marketplacePath = path.join(stagingDir, '.agents', 'plugins', 'marketplace.json')
    await ensureDir(path.dirname(marketplacePath))
    await fs.copyFile(path.join(outRoot, '.agents', 'plugins', 'marketplace.json'), marketplacePath)

    if (await pathExists(persistentRoot)) {
      backupDir = await fs.mkdtemp(path.join(stagingParent, `.${path.basename(persistentRoot)}.backup-`))
      backupPath = path.join(backupDir, path.basename(persistentRoot))
      await fs.rename(persistentRoot, backupPath)
      await fs.rename(stagingDir, persistentRoot)
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
      backupDir = undefined
      backupPath = undefined
    } else {
      await fs.rename(stagingDir, persistentRoot)
    }
  } catch (error) {
    await removeIfExists(stagingDir)
    if (backupPath && await pathExists(backupPath)) {
      await removeIfExists(persistentRoot)
      await fs.rename(backupPath, persistentRoot)
    }
    if (backupDir) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    }
    throw error
  }

  return {
    root: persistentRoot,
    marketplacePath: path.join(persistentRoot, '.agents', 'plugins', 'marketplace.json'),
  }
}

const codexMutableMarketplaceInterfaceSchema = z.looseObject({
  displayName: z.string().trim().min(1),
})

const codexMutableMarketplacePluginSchema = z.looseObject({
  name: z.string().trim().min(1),
  source: z.looseObject({
    source: z.literal('local'),
    path: z.string().trim().min(1),
  }),
  policy: z.looseObject({
    installation: z.enum(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE']),
    authentication: z.enum(['ON_INSTALL', 'ON_USE']),
  }),
  category: z.string().trim().min(1),
})

const codexMutableMarketplaceSchema = z.looseObject({
  name: z.string().trim().min(1).optional(),
  interface: z.unknown().optional(),
  plugins: z.array(z.unknown()).optional(),
})

const codexMutableMarketplaceWriteSchema = z.looseObject({
  name: z.string().trim().min(1),
  interface: codexMutableMarketplaceInterfaceSchema,
  plugins: z.array(z.unknown()),
})

type CodexMutableMarketplace = z.infer<typeof codexMutableMarketplaceSchema>
type CodexMutableMarketplacePlugin = z.infer<typeof codexMutableMarketplacePluginSchema>

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function parseMutableMarketplace(rawMarketplace: unknown, marketplacePath: string) {
  if (rawMarketplace == null) {
    return undefined
  }
  if (typeof rawMarketplace !== 'object' || Array.isArray(rawMarketplace)) {
    throw new Error(`Invalid Codex marketplace at ${marketplacePath}: expected a JSON object`)
  }

  const parsed = codexMutableMarketplaceSchema.safeParse(rawMarketplace)
  if (parsed.success) {
    return parsed.data
  }

  const issue = parsed.error.issues[0]
  throw new Error(`Invalid Codex marketplace at ${marketplacePath}: ${issue?.message ?? 'invalid data'}`)
}

function resolveMarketplaceInterface(
  rawInterface: unknown,
  fallbackInterface: CodexMarketplaceManifest['interface']
) {
  const interfaceRecord = toRecord(rawInterface) ?? {}
  const displayName =
    typeof interfaceRecord.displayName === 'string' && interfaceRecord.displayName.trim()
      ? interfaceRecord.displayName.trim()
      : fallbackInterface.displayName

  return codexMutableMarketplaceInterfaceSchema.parse({
    ...interfaceRecord,
    displayName,
  })
}

function mergeMarketplacePlugin(
  existingPlugin: unknown,
  managedPlugin: CodexMarketplacePlugin
): CodexMutableMarketplacePlugin {
  const existingRecord = toRecord(existingPlugin) ?? {}
  const existingSource = toRecord(existingRecord.source) ?? {}
  const existingPolicy = toRecord(existingRecord.policy) ?? {}

  return codexMutableMarketplacePluginSchema.parse({
    ...existingRecord,
    ...managedPlugin,
    source: {
      ...existingSource,
      ...managedPlugin.source,
    },
    policy: {
      ...existingPolicy,
      ...managedPlugin.policy,
    },
  })
}

async function writeMutableMarketplace(marketplacePath: string, marketplace: unknown) {
  const parsed = codexMutableMarketplaceWriteSchema.safeParse(marketplace)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid Codex marketplace at ${marketplacePath}: ${issue?.message ?? 'invalid data'}`)
  }

  await writeJsonFile(marketplacePath, parsed.data)
}

function buildMarketplaceContainer(
  cfg: ProviderExportContext['cfg'],
  rawMarketplace: unknown,
  relativePluginRoot: string,
  marketplacePath: string
) {
  const fallback = buildCodexMarketplaceManifest(cfg, [], relativePluginRoot)
  const parsedMarketplace = parseMutableMarketplace(rawMarketplace, marketplacePath)
  if (!parsedMarketplace) {
    return {
      raw: {} as CodexMutableMarketplace,
      name: fallback.name,
      interface: fallback.interface,
      plugins: [] as unknown[],
    }
  }

  const marketplace = parsedMarketplace
  return {
    raw: marketplace,
    name: marketplace.name?.trim() || fallback.name,
    interface: resolveMarketplaceInterface(marketplace.interface, fallback.interface),
    plugins: [...(marketplace.plugins ?? [])],
  }
}

function matchesMarketplaceEntry(candidate: unknown, expected: CodexMarketplacePlugin) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false
  }

  const candidateRecord = candidate as {
    name?: unknown
    source?: { source?: unknown; path?: unknown }
  }
  return (
    candidateRecord.name === expected.name &&
    candidateRecord.source?.source === expected.source.source &&
    candidateRecord.source?.path === expected.source.path
  )
}

function summarizePluginRemoval(removal: FileRemovalSummary, marketplaceOutcome: 'removed' | 'missing' | 'kept') {
  if (removal.kept.length > 0 || marketplaceOutcome === 'kept') {
    return 'kept' as const
  }
  if (removal.removed.length > 0 || marketplaceOutcome === 'removed') {
    return 'removed' as const
  }
  return 'missing' as const
}

function shouldFallBackFromAppServer(result: Exclude<CodexInstallResult, { ok: true }>) {
  return result.reason === 'codex_not_installed' || result.reason === 'codex_too_old'
}

function warnCodexAppServerFallback(result: Exclude<CodexInstallResult, { ok: true }>) {
  if (result.reason === 'codex_too_old') {
    console.warn(`${result.detail} Falling back to direct Codex marketplace writes; upgrade Codex to >= 0.113.0 for automatic enable.`)
    return
  }
  console.warn(`Codex JSON-RPC install unavailable (${result.detail}). Falling back to direct Codex marketplace writes.`)
}

function failCodexAppServer(result: Exclude<CodexInstallResult, { ok: true }>): never {
  throw new Error(result.detail)
}

async function readCodexMarketplaceName(marketplacePath: string) {
  const rawMarketplace = await readJsonFile<unknown>(marketplacePath)
  const parsedMarketplace = rawMarketplace == null ? undefined : parseMutableMarketplace(rawMarketplace, marketplacePath)
  return parsedMarketplace?.name?.trim() || 'agentrig-local'
}

export const codexProvider: PluginProviderAdapter = {
  id: 'codex',
  async exportMarketplace({ outRoot, cfg, plugins }) {
    const pluginRoot = path.join(outRoot, 'plugins')
    const marketplacePath = path.join(outRoot, '.agents', 'plugins', 'marketplace.json')
    await ensureDir(pluginRoot)
    await ensureDir(path.dirname(marketplacePath))

    for (const plugin of plugins) {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      const pluginDir = path.join(pluginRoot, pluginName)
      await copyCodexPlugin(plugin.pluginSourceDir, pluginDir)
      const features = await detectPluginFeatures(pluginDir)
      await writeJsonFile(
        path.join(pluginDir, '.codex-plugin', 'plugin.json'),
        buildCodexPluginManifest(plugin, cfg.owner, features, pluginName)
      )
    }

    await writeJsonFile(marketplacePath, buildCodexMarketplaceManifest(cfg, plugins))

    return {
      provider: 'codex',
      outRoot,
      marketplaceName: cfg.providers.codex.marketplaceName,
      plugins,
    }
  },
  previewInstall({ cwd, plugins, scope, cfg }) {
    const { pluginRoot, marketplacePath } = resolveCodexInstallPaths(cwd, scope)
    const providerPlugins = plugins.map((plugin) => {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      return {
        pluginName,
        ...resolveCodexPluginDestination({
          pluginRoot,
          relativePluginRoot: '',
          scope,
          marketplaceName: cfg.providers.codex.marketplaceName,
          pluginName,
          version: plugin.manifest.version,
        }),
      }
    })
    return {
      provider: 'codex',
      scope,
      locations: [pluginRoot, marketplacePath, ...providerPlugins.map((plugin) => plugin.destinationDir)],
      actions: [
        ...providerPlugins.map((plugin) => `copy ${plugin.pluginName} -> ${plugin.destinationDir}`),
        `update ${marketplacePath}`,
      ],
    }
  },
  async install({ cwd, result, cfg, scope, requestedScope, installMetadataByPluginId, force, dryRun, enable }) {
    if (!dryRun) {
      const staged = await stageCodexMarketplaceForInstall(result.outRoot, result.marketplaceName)
      const installed: string[] = []
      const ledgerEntries: CodexPluginInstallRecord[] = []

      for (const plugin of result.plugins) {
        const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
        const installMetadata = installMetadataByPluginId[plugin.manifest.id]
        if (!installMetadata) {
          throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
        }
        const entry = codexMarketplacePluginSchema.parse({
          name: pluginName,
          source: {
            source: 'local',
            path: `./plugins/${pluginName}`,
          },
          policy: {
            installation: cfg.providers.codex.installationPolicy,
            authentication: cfg.providers.codex.authenticationPolicy,
          },
          category: cfg.providers.codex.category,
        })
        const installResult = await codexInstallPlugin({
          marketplaceName: result.marketplaceName,
          pluginName,
          version: plugin.manifest.version,
          sourcePath: staged.marketplacePath,
          enable,
        })

        if (!installResult.ok) {
          if (installed.length === 0 && shouldFallBackFromAppServer(installResult)) {
            warnCodexAppServerFallback(installResult)
            break
          }
          failCodexAppServer(installResult)
        }

        installed.push(pluginName)
        if (enable) {
          console.log(`Installed and enabled ${pluginName} in Codex (${installResult.installPath}).`)
        } else {
          console.log(`Installed ${pluginName} in Codex (disabled). Press Space in Codex TUI under /plugins to enable.`)
        }
        ledgerEntries.push({
          id: getPluginInstallRecordId('codex', scope, pluginName),
          provider: 'codex',
          requestedScope,
          specIdentity: installMetadata.specIdentity,
          registry: installMetadata.registry,
          scope,
          pluginId: plugin.manifest.id,
          pluginVersion: plugin.manifest.version,
          snapshotDigest: installMetadata.snapshotDigest,
          pluginName,
          targetPaths: [installResult.installPath, staged.marketplacePath],
          installedAt: new Date().toISOString(),
          files: [],
          metadata: {
            pluginPath: installResult.installPath,
            marketplacePath: staged.marketplacePath,
            marketplaceEntry: entry,
            marketplaceName: result.marketplaceName,
            pluginRef: `${pluginName}@${result.marketplaceName}`,
            appServerInstalled: true,
          },
        })
      }

      if (installed.length > 0) {
        return {
          provider: 'codex',
          scope,
          installed,
          skipped: [],
          locations: [staged.root, ...ledgerEntries.map((entry) => entry.metadata.pluginPath)],
          ledgerEntries,
        }
      }
    }

    const installed: string[] = []
    const skipped: string[] = []
    const ledgerEntries: CodexPluginInstallRecord[] = []
    const { pluginRoot, marketplacePath, relativePluginRoot } = resolveCodexInstallPaths(cwd, scope)
    const pluginSourceRoot = path.join(result.outRoot, 'plugins')
    const installLedger = dryRun ? null : await loadPluginInstallLedger(cwd, scope)

    for (const plugin of result.plugins) {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      const installMetadata = installMetadataByPluginId[plugin.manifest.id]
      if (!installMetadata) {
        throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
      }

      const { destinationDir } = resolveCodexPluginDestination({
        pluginRoot,
        relativePluginRoot,
        scope,
        marketplaceName: result.marketplaceName,
        pluginName,
        version: plugin.manifest.version,
      })
      const existingRecordId = getPluginInstallRecordId('codex', scope, pluginName)
      const destinationExists = dryRun ? false : await pathExists(destinationDir)
      if (!destinationExists || force) continue

      const existingRecord = installLedger?.installs[existingRecordId]
      if (!existingRecord) {
        throw new Error(
          `Codex plugin ${pluginName} already exists at ${destinationDir} without a matching AgentRig ledger entry. Re-run with --force to repair.`
        )
      }
      if (!isSamePluginInstallSpecIdentity(existingRecord.specIdentity, installMetadata.specIdentity)) {
        throw new Error(
          `Codex plugin ${pluginName} already exists at ${destinationDir} for a different AgentRig source. Re-run with --force to replace it.`
        )
      }
    }

    const rawMarketplace = await readJsonFile<unknown>(marketplacePath)
    const marketplace = buildMarketplaceContainer(cfg, rawMarketplace, relativePluginRoot, marketplacePath)
    const existingPlugins: unknown[] = [...marketplace.plugins]

    for (const plugin of result.plugins) {
      const pluginName = providerPluginName(plugin, 'codex', cfg.pluginPrefix)
      const sourceDir = path.join(pluginSourceRoot, pluginName)
      const { destinationDir, marketplaceSourcePath } = resolveCodexPluginDestination({
        pluginRoot,
        relativePluginRoot,
        scope,
        marketplaceName: result.marketplaceName,
        pluginName,
        version: plugin.manifest.version,
      })
      const copyResult = dryRun
        ? { changed: true, files: [] }
        : await copyInstalledPlugin(sourceDir, destinationDir, force)
      const changed = copyResult.changed
      if (changed) {
        installed.push(pluginName)
      } else {
        skipped.push(pluginName)
      }

      const entry = codexMarketplacePluginSchema.parse({
        name: pluginName,
        source: {
          source: 'local',
          path: marketplaceSourcePath,
        },
        policy: {
          installation: cfg.providers.codex.installationPolicy,
          authentication: cfg.providers.codex.authenticationPolicy,
        },
        category: cfg.providers.codex.category,
      })

      const index = existingPlugins.findIndex((item) => toRecord(item)?.name === pluginName)
      if (index >= 0) {
        existingPlugins[index] = mergeMarketplacePlugin(existingPlugins[index], entry)
      } else {
        existingPlugins.push(codexMutableMarketplacePluginSchema.parse(entry))
      }

      if (changed) {
        const installMetadata = installMetadataByPluginId[plugin.manifest.id]
        if (!installMetadata) {
          throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
        }
        ledgerEntries.push({
          id: getPluginInstallRecordId('codex', scope, pluginName),
          provider: 'codex',
          requestedScope,
          specIdentity: installMetadata.specIdentity,
          registry: installMetadata.registry,
          scope,
          pluginId: plugin.manifest.id,
          pluginVersion: plugin.manifest.version,
          snapshotDigest: installMetadata.snapshotDigest,
          pluginName,
          targetPaths: [destinationDir, marketplacePath],
          installedAt: new Date().toISOString(),
          files: copyResult.files,
          metadata: {
            pluginPath: destinationDir,
            marketplacePath,
            marketplaceEntry: entry,
          },
        })
      }
    }

    if (!dryRun) {
      await writeMutableMarketplace(
        marketplacePath,
        {
          ...marketplace.raw,
          name: marketplace.name,
          interface: marketplace.interface,
          plugins: existingPlugins,
        }
      )
    }

    return {
      provider: 'codex',
      scope,
      installed,
      skipped,
      locations: [pluginRoot, marketplacePath],
      ledgerEntries,
    }
  },
  async uninstall({ cwd, entries, dryRun }) {
    const removed: string[] = []
    const kept: string[] = []
    const missing: string[] = []
    const clearedRecordIds: string[] = []
    const locations = new Set<string>()

    for (const entry of entries) {
      if (entry.provider !== 'codex') continue
      for (const targetPath of entry.targetPaths) {
        locations.add(targetPath)
      }
      if (!dryRun) {
        const marketplaceName = entry.metadata.marketplaceName ??
          await readCodexMarketplaceName(entry.metadata.marketplacePath).catch(() => 'agentrig-local')
        const uninstallResult = await codexUninstallPlugin({
          marketplaceName,
          pluginName: entry.pluginName,
        })
        if (uninstallResult.ok) {
          removed.push(entry.pluginName)
          clearedRecordIds.push(entry.id)
          continue
        }
        const canDirectCleanup =
          shouldFallBackFromAppServer(uninstallResult) ||
          (!entry.metadata.appServerInstalled && /not found|not installed/i.test(uninstallResult.detail))
        if (!canDirectCleanup) {
          failCodexAppServer(uninstallResult)
        }
        if (entry.metadata.appServerInstalled) {
          console.warn(`Codex JSON-RPC uninstall unavailable (${uninstallResult.detail}). Keeping the AgentRig ledger entry because Codex owns the app-server install cache.`)
          kept.push(entry.pluginName)
          continue
        }
        console.warn(`Codex JSON-RPC uninstall unavailable (${uninstallResult.detail}). Falling back to direct Codex file cleanup.`)
      }
      const { pluginRoot, marketplacePath } = resolveCodexInstallPaths(cwd, entry.scope)
      const pluginPath = assertContainedPath(
        pluginRoot,
        entry.metadata.pluginPath,
        'Codex plugin install'
      )
      locations.add(pluginPath)
      locations.add(marketplacePath)

      const rawMarketplace = await readJsonFile<unknown>(marketplacePath)
      const parsedMarketplace =
        rawMarketplace == null ? undefined : parseMutableMarketplace(rawMarketplace, marketplacePath)

      const removal = await removeInstalledFiles(pluginPath, entry.files, dryRun)
      let marketplaceOutcome: 'removed' | 'missing' | 'kept' = 'missing'
      if (removal.kept.length > 0) {
        marketplaceOutcome = 'kept'
      }

      if (marketplaceOutcome === 'kept') {
        // Keep marketplace state untouched when any tracked plugin file was modified.
      } else if (parsedMarketplace == null) {
        marketplaceOutcome = 'missing'
      } else {
        const plugins = [...(parsedMarketplace.plugins ?? [])]
        const index = plugins.findIndex((plugin) => matchesMarketplaceEntry(plugin, entry.metadata.marketplaceEntry))
        if (index < 0) {
          marketplaceOutcome = 'missing'
        } else {
          marketplaceOutcome = 'removed'
          if (!dryRun) {
            plugins.splice(index, 1)
            await writeMutableMarketplace(marketplacePath, {
              ...parsedMarketplace,
              plugins,
            })
          }
        }
      }

      const outcome = summarizePluginRemoval(removal, marketplaceOutcome)
      if (outcome === 'removed') {
        removed.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      } else if (outcome === 'missing') {
        missing.push(entry.pluginName)
        clearedRecordIds.push(entry.id)
      } else {
        kept.push(entry.pluginName)
      }

      if (outcome !== 'kept' && !dryRun) {
        // Strip residual `.DS_Store` and empty parent dirs left behind by file
        // removal. We bound the ancestor walk to the codex plugin root so we
        // never touch user-owned siblings outside the agentrig-managed scope.
        await cleanEmptyAncestors(pluginPath, pluginRoot, dryRun).catch(() => {})
      }
    }

    return {
      provider: 'codex',
      removed,
      kept,
      missing,
      locations: [...locations],
      clearedRecordIds,
    }
  },
}
