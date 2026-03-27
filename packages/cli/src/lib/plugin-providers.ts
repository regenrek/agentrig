import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathExists, removeIfExists } from './fs'
import { claudeProvider } from './plugin-providers/claude'
import { codexProvider } from './plugin-providers/codex'
import { cursorProvider } from './plugin-providers/cursor'
import {
  PLUGIN_PROVIDER_IDS,
  buildPackEntries,
  defaultCommandRunner,
  formatProviderSummary,
  loadPluginConfig,
  parsePluginInstallScope,
  parsePluginProviderSelector,
  resolveExportBaseOut,
  resolvePluginProviders,
  resolveProviderOutRoot,
  type ExternalCommandRunner,
  type PluginExportOptions,
  type PluginInstallOptions,
  type PluginInstallScope,
  type PluginProviderAdapter,
  type PluginProviderId,
  type PluginProviderSelector,
  type ProviderExportResult,
  type ProviderInstallResult,
} from './plugin-providers/shared'

const PROVIDER_ADAPTERS: Record<PluginProviderId, PluginProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
  cursor: cursorProvider,
}

export {
  PLUGIN_PROVIDER_IDS,
  formatProviderSummary,
  parsePluginInstallScope,
  parsePluginProviderSelector,
  resolvePluginProviders,
}

export type {
  ExternalCommandRunner,
  PluginExportOptions,
  PluginInstallOptions,
  PluginInstallScope,
  PluginProviderId,
  PluginProviderSelector,
  ProviderExportResult,
  ProviderInstallResult,
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
    results.push(
      await PROVIDER_ADAPTERS[provider].exportMarketplace({
        outRoot: providerOut,
        cfg,
        packs,
      })
    )
  }

  return results
}

export async function installPluginProviders(options: PluginInstallOptions): Promise<ProviderInstallResult[]> {
  const cfg = await loadPluginConfig(options.cwd, options.configPath, options)
  const baseOut = options.out
    ? path.resolve(options.cwd, options.out)
    : await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugins-'))

  const dryRun = Boolean(options.dryRun)
  const force = Boolean(options.force)
  const scope = options.scope ?? 'personal'
  const commandRunner: ExternalCommandRunner = options.commandRunner ?? defaultCommandRunner

  try {
    const exportResults = await exportPluginProviders({
      ...options,
      out: baseOut,
      clean: options.out ? options.clean : true,
    })

    const installs: ProviderInstallResult[] = []
    for (const result of exportResults) {
      installs.push(
        await PROVIDER_ADAPTERS[result.provider].install({
          cwd: options.cwd,
          result,
          cfg,
          scope,
          force,
          dryRun,
          runner: commandRunner,
        })
      )
    }
    return installs
  } finally {
    if (!options.out) {
      await removeIfExists(baseOut)
    }
  }
}
