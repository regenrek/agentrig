import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadPluginInstallLedgers,
  removePluginInstallRecords,
  upsertPluginInstallRecords,
} from './plugin-install-ledger'
import { pathExists, removeIfExists } from './fs'
import { claudeProvider } from './plugin-providers/claude'
import { codexProvider } from './plugin-providers/codex'
import { cursorProvider } from './plugin-providers/cursor'
import {
  PLUGIN_PROVIDER_IDS,
  buildPluginEntries,
  defaultCommandRunner,
  formatProviderSummary,
  loadPluginConfig,
  parsePluginInstallScope,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  resolveInstallScope,
  resolveExportBaseOut,
  resolvePluginProviders,
  resolveProviderOutRoot,
  type ExternalCommandRunner,
  type PluginInstallScopeSelector,
  type PluginExportOptions,
  type PluginInstallOptions,
  type PluginInstallScope,
  type PluginProviderAdapter,
  type PluginProviderId,
  type PluginProviderSelector,
  type PluginUninstallOptions,
  type PreparedPluginInstall,
  type ProviderInstallPreview,
  type ProviderExportResult,
  type ProviderInstallResult,
  type ProviderUninstallResult,
} from './plugin-providers/shared'
import type { PluginInstallRecord } from './types'

const PROVIDER_ADAPTERS: Record<PluginProviderId, PluginProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
  cursor: cursorProvider,
}

export {
  PLUGIN_PROVIDER_IDS,
  formatProviderSummary,
  parsePluginInstallScope,
  parsePluginInstallScopeSelector,
  parsePluginProviderSelector,
  resolveInstallScope,
  resolvePluginProviders,
}

export type {
  ExternalCommandRunner,
  PluginInstallScopeSelector,
  PluginExportOptions,
  PluginInstallOptions,
  PluginInstallScope,
  PluginProviderId,
  PluginProviderSelector,
  PluginUninstallOptions,
  PreparedPluginInstall,
  ProviderInstallPreview,
  ProviderExportResult,
  ProviderInstallResult,
  ProviderUninstallResult,
}

export async function exportPluginProviders(options: PluginExportOptions): Promise<ProviderExportResult[]> {
  const providers = resolvePluginProviders(options.agent)
  const baseOut = resolveExportBaseOut(options.cwd, options.agent, options.out)
  const pluginsRoot = path.resolve(options.cwd, options.pluginsDir)
  const cfg = await loadPluginConfig(options.cwd, options.configPath, options)

  if (!(await pathExists(pluginsRoot))) {
    throw new Error(`Missing plugins directory: ${pluginsRoot}`)
  }

  if (options.clean) {
    await removeIfExists(baseOut)
  }

  const plugins = await buildPluginEntries(pluginsRoot, cfg.pluginPrefix, options.plugin)
  const results: ProviderExportResult[] = []

  for (const provider of providers) {
    const providerOut = resolveProviderOutRoot(baseOut, options.agent, provider)
    results.push(
      await PROVIDER_ADAPTERS[provider].exportMarketplace({
        outRoot: providerOut,
        cfg,
        plugins,
      })
    )
  }

  return results
}

export async function preparePluginInstall(options: PluginInstallOptions): Promise<PreparedPluginInstall> {
  const cfg = await loadPluginConfig(options.cwd, options.configPath, options)
  const pluginsRoot = path.resolve(options.cwd, options.pluginsDir)
  if (!(await pathExists(pluginsRoot))) {
    throw new Error(`Missing plugins directory: ${pluginsRoot}`)
  }

  const plugins = await buildPluginEntries(pluginsRoot, cfg.pluginPrefix, options.plugin)
  const installMetadataByPluginId = options.installMetadataByPluginId
  for (const plugin of plugins) {
    if (!installMetadataByPluginId[plugin.manifest.id]) {
      throw new Error(`Missing verified install metadata for plugin: ${plugin.manifest.id}`)
    }
  }
  const requestedScope = options.scope ?? 'auto'
  const baseOut = options.out
    ? path.resolve(options.cwd, options.out)
    : await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugins-'))
  const providers = resolvePluginProviders(options.agent).map((provider) => {
    const scope = resolveInstallScope(provider, requestedScope)
    const outRoot = resolveProviderOutRoot(baseOut, options.agent, provider)
    return {
      provider,
      scope,
      preview: PROVIDER_ADAPTERS[provider].previewInstall({
        cwd: options.cwd,
        outRoot,
        cfg,
        plugins,
        scope,
      }),
    }
  })

  return {
    cwd: options.cwd,
    cfg,
    pluginsRoot,
    plugins,
    baseOut,
    out: options.out ? path.resolve(options.cwd, options.out) : undefined,
    clean: options.clean ?? true,
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun),
    enable: options.enable ?? true,
    installMetadataByPluginId,
    requestedScope,
    providers,
    commandRunner: options.commandRunner ?? defaultCommandRunner,
    exportOptions: {
      cwd: options.cwd,
      agent: options.agent,
      pluginsDir: options.pluginsDir,
      out: options.out ? path.resolve(options.cwd, options.out) : undefined,
      configPath: options.configPath,
      marketplaceName: options.marketplaceName,
      ownerName: options.ownerName,
      ownerEmail: options.ownerEmail,
      pluginPrefix: options.pluginPrefix,
      clean: options.clean,
      plugin: options.plugin,
    },
  }
}

export async function installPreparedPluginProviders(plan: PreparedPluginInstall): Promise<ProviderInstallResult[]> {
  const baseOut = plan.baseOut

  try {
    const exportResults = await exportPluginProviders({
      ...plan.exportOptions,
      out: baseOut,
      clean: plan.out ? plan.clean : true,
    })

    const installs: ProviderInstallResult[] = []
    for (const result of exportResults) {
      const providerPlan = plan.providers.find((item) => item.provider === result.provider)
      if (!providerPlan) {
        throw new Error(`Missing install plan for provider: ${result.provider}`)
      }

      installs.push(
        await PROVIDER_ADAPTERS[result.provider].install({
          cwd: plan.cwd,
          result,
          cfg: plan.cfg,
          scope: providerPlan.scope,
          requestedScope: plan.requestedScope,
          installMetadataByPluginId: plan.installMetadataByPluginId,
          force: plan.force,
          dryRun: plan.dryRun,
          enable: plan.enable,
          runner: plan.commandRunner,
        })
      )
    }

    if (!plan.dryRun) {
      const recordsByScope = new Map<PluginInstallScope, PluginInstallRecord[]>()
      for (const install of installs) {
        const existing = recordsByScope.get(install.scope) ?? []
        existing.push(...install.ledgerEntries)
        recordsByScope.set(install.scope, existing)
      }
      for (const [scope, records] of recordsByScope) {
        if (records.length > 0) {
          await upsertPluginInstallRecords(plan.cwd, scope, records)
        }
      }
    }

    return installs
  } finally {
    if (!plan.out) {
      await removeIfExists(baseOut)
    }
  }
}

export async function installPluginProviders(options: PluginInstallOptions): Promise<ProviderInstallResult[]> {
  const plan = await preparePluginInstall(options)
  return installPreparedPluginProviders(plan)
}

export async function uninstallPluginProviders(
  records: PluginInstallRecord[],
  options: PluginUninstallOptions
): Promise<ProviderUninstallResult[]> {
  const dryRun = Boolean(options.dryRun)
  const runner: ExternalCommandRunner = options.commandRunner ?? defaultCommandRunner
  const results: ProviderUninstallResult[] = []

  const recordsByScope = new Map<PluginInstallScope, PluginInstallRecord[]>()
  for (const record of records) {
    const scopedRecords = recordsByScope.get(record.scope) ?? []
    scopedRecords.push(record)
    recordsByScope.set(record.scope, scopedRecords)
  }

  const ledgers = await loadPluginInstallLedgers(options.cwd)

  for (const provider of PLUGIN_PROVIDER_IDS) {
    const providerEntries = records.filter((record) => record.provider === provider)
    if (providerEntries.length === 0) continue

    const remainingEntries = [
      ...Object.values(ledgers.personal.installs),
      ...Object.values(ledgers.workspace.installs),
    ].filter((record) => !providerEntries.some((entry) => entry.id === record.id))

    const result = await PROVIDER_ADAPTERS[provider].uninstall({
      cwd: options.cwd,
      entries: providerEntries,
      remainingEntries,
      dryRun,
      runner,
    })
    results.push(result)
  }

  if (!dryRun) {
    for (const [scope, scopedRecords] of recordsByScope) {
      const clearedIds = results.flatMap((result) => result.clearedRecordIds)
      const scopeClearedIds = scopedRecords.filter((record) => clearedIds.includes(record.id)).map((record) => record.id)
      if (scopeClearedIds.length > 0) {
        await removePluginInstallRecords(options.cwd, scope, scopeClearedIds)
      }
    }
  }

  return results
}
