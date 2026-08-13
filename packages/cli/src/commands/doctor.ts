import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import {
  PluginManifestSchema,
  agentRigPluginExtension,
  agentRigInstallCommandFingerprint,
  capabilityResolutionToJson,
  parseCapabilityPluginRef,
  resolveCapabilityGraph,
  type CapabilityChosenProvider,
  type CapabilityPluginLoader,
  type CapabilityPluginRecord,
  type CapabilityResolutionIssue,
  type CapabilityResolutionResult,
  type CapabilityTarget,
  type InstallBundle,
  type PluginManifest,
  type RegistryInstallability,
  type TrustTier,
} from '@agentrig/sdk'
import cliPackageJson from '../../package.json'
import sdkPackageJson from '../../../sdk/package.json'
import { loadConfig } from '../lib/config'
import {
  cleanupMaterializedPlugin,
  materializeResolvedPluginGraph,
  type ResolvedPluginGraph,
} from '../lib/plugin-consumer'
import { buildResolvedPluginInstallMetadataMap } from '../lib/plugin-install-spec'
import { listPluginInstallRecords, listSelectionInstallRecords, loadPluginInstallLedgers } from '../lib/plugin-install-ledger'
import {
  installBundleSnapshotDigest,
  readInstallBundleFile,
} from '../lib/registry'
import { resolvePluginSpec } from '../lib/plugin-resolver'
import { parseRegistryPluginSpec } from '../lib/registry-spec'
import { pathExists, readJsonFile } from '../lib/fs'
import {
  exportPluginProviders,
  preparePluginInstall,
  resolveInstallScope,
  type PluginProviderId,
  type ProviderExportResult,
} from '../lib/plugin-providers'
import { providerPluginName } from '../lib/plugin-providers/shared'
import { sha256Hex } from '../lib/hash'
import type {
  PluginInstallRecord,
  PluginInstallScopeName,
  RegistryRef,
  SelectionInstallRecord,
} from '../lib/types'

type DoctorStatus = 'pass' | 'warn' | 'fail' | 'unknown'
type DoctorSection = 'Core' | 'Capabilities' | 'Provider' | 'Status'

export type DoctorCheck = {
  id: string
  section: DoctorSection
  label: string
  status: DoctorStatus
  message?: string
  details?: unknown
}

type DoctorInput = {
  spec?: string
  provider?: CapabilityTarget
  cwd: string
}

type DoctorJson = {
  schemaVersion: 1
  ok: boolean
  status: 'ready' | 'failed' | 'warning'
  input: DoctorInput
  versions: {
    cli: string
    sdk: string
  }
  checks: DoctorCheck[]
  capabilityResolution?: ReturnType<typeof capabilityResolutionToJson>
  provider?: {
    selected: CapabilityTarget
    scope: PluginInstallScopeName
    previewLocations: string[]
  }
  exitCode: 0 | 1
}

type LoadedPluginRecord = CapabilityPluginRecord & {
  bundle: InstallBundle
}

const DEFAULT_REGISTRY_ALIAS = 'agentrig'
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const command = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check AgentRig registry, capability, install, provider, and environment health.',
  },
  args: {
    spec: {
      type: 'positional',
      description: 'Optional canonical install ref: <registryAlias>/<namespace.plugin>',
      required: false,
    },
    provider: {
      type: 'string',
      description: 'Provider target to check: codex, claude-code, or cursor',
    },
    cwd: {
      type: 'string',
      description: 'Working directory (defaults to current directory)',
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const result = await runDoctor({
      spec: typeof args.spec === 'string' ? args.spec : undefined,
      provider: typeof args.provider === 'string' ? args.provider : undefined,
      cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
    })

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(formatDoctorReport(result))
    }

    process.exitCode = result.exitCode
  },
})

export default command

export async function runDoctor(args: {
  spec?: string
  provider?: string
  cwd?: string
}): Promise<DoctorJson> {
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd()
  const checks: DoctorCheck[] = []
  const addCheck = (check: DoctorCheck) => checks.push(check)
  const provider = args.provider ? parseSingleProvider(args.provider) : undefined
  const installProvider = provider ? providerTargetToPluginProvider(provider) : undefined
  const input: DoctorInput = { cwd, ...(args.spec ? { spec: args.spec } : {}), ...(provider ? { provider } : {}) }
  let capabilityResolution: CapabilityResolutionResult | undefined
  let providerPreview: DoctorJson['provider']
  let materializedPluginsRoot: string | undefined
  let resolvedBundles: InstallBundle[] = []

  addCheck({
    id: 'cli-version',
    section: 'Core',
    status: 'pass',
    label: `agentrig CLI ${cliPackageJson.version}`,
  })
  addCheck({
    id: 'sdk-version',
    section: 'Core',
    status: 'pass',
    label: `AgentRig SDK ${sdkPackageJson.version}`,
  })

  const cfg = await loadConfig(cwd)

  if (!args.spec) {
    addCheck({
      id: 'registry-availability',
      section: 'Core',
      status: 'unknown',
      label: 'registry availability',
      message: 'Skipped because no plugin ref was provided; registry reachability is verified during plugin resolution.',
    })
    addCheck({
      id: 'plugin-schema-validity',
      section: 'Core',
      status: 'unknown',
      label: 'plugin schema validity',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'plugin-dependency-closure',
      section: 'Core',
      status: 'unknown',
      label: 'plugin dependency closure',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'capability-resolution',
      section: 'Capabilities',
      status: 'unknown',
      label: 'capability resolution',
      message: 'Skipped because no plugin ref was provided.',
    })
  } else {
    const loader = new RegistryCapabilityPluginLoader({
      cwd,
      registries: cfg.registries,
      rootRef: args.spec,
    })

    capabilityResolution = await resolveCapabilityGraph({
      pluginRef: args.spec,
      loader,
    })

    for (const warning of loader.metadataWarnings) addCheck(warning)

    const rootRecord = loader.getRecord(parseCapabilityPluginRef(args.spec).name)
    resolvedBundles = loader.getBundles()

    addCheck({
      id: 'registry-availability',
      section: 'Core',
      status: rootRecord ? 'pass' : 'fail',
      label: rootRecord ? 'registry reachable' : 'registry/plugin resolution failed',
      message: rootRecord
        ? undefined
        : loader.getLoadError(parseCapabilityPluginRef(args.spec).name)
          ?? firstIssueMessage(capabilityResolution.errors)
          ?? `Unable to resolve ${args.spec}.`,
    })

    addCheck({
      id: 'plugin-schema-validity',
      section: 'Core',
      status: loader.schemaErrors.length === 0 && rootRecord ? 'pass' : 'fail',
      label: loader.schemaErrors.length === 0 && rootRecord ? 'plugin schema valid' : 'plugin schema validity failed',
      message: loader.schemaErrors.join('; ') || undefined,
    })

    const hardCapabilityErrors = capabilityResolution.errors.filter((issue) => issue.code !== 'stale_provider')
    const dependencyErrors = hardCapabilityErrors.filter((issue) => issue.code === 'dependency_not_found')
    addCheck({
      id: 'plugin-dependency-closure',
      section: 'Core',
      status: dependencyErrors.length === 0 && rootRecord ? 'pass' : 'fail',
      label: dependencyErrors.length === 0 && rootRecord ? 'plugin dependency closure resolved' : 'plugin dependency closure failed',
      message: dependencyErrors.map((issue) => issue.message).join('; ') || undefined,
      details: dependencyErrors.length ? dependencyErrors : undefined,
    })

    const capabilityHardErrors = hardCapabilityErrors.filter((issue) => issue.code !== 'dependency_not_found')
    addCheck({
      id: 'capability-resolution',
      section: 'Capabilities',
      status: capabilityHardErrors.length === 0 && rootRecord ? 'pass' : 'fail',
      label: capabilityHardErrors.length === 0 && rootRecord ? 'capability resolution resolved' : 'capability resolution failed',
      message: capabilityHardErrors.map((issue) => issue.message).join('; ') || undefined,
      details: capabilityHardErrors.length ? capabilityHardErrors : undefined,
    })

    addResolvedPluginChecks(capabilityResolution, addCheck)
    addCapabilityProviderChecks(capabilityResolution, provider, addCheck)

    if (rootRecord && resolvedBundles.length > 0) {
      try {
        const graph: ResolvedPluginGraph = {
          requestedPlugin: rootRecord.bundle,
          resolvedPlugins: resolvedBundles,
        }
        const materialized = await materializeResolvedPluginGraph(graph)
        materializedPluginsRoot = materialized.pluginsRoot

        addCheck({
          id: 'install-bundle-hashes',
          section: 'Core',
          status: 'pass',
          label: 'install bundle hashes verified',
        })

        await addSmokeTestChecks(materialized.pluginsRoot, capabilityResolution.chosenProviders, addCheck)
        await addMcpAndEnvChecks(materialized.pluginsRoot, capabilityResolution.chosenProviders, addCheck)

        if (provider && installProvider) {
          providerPreview = await addProviderPreviewChecks({
            cwd,
            provider,
            installProvider,
            pluginsRoot: materialized.pluginsRoot,
            bundles: resolvedBundles,
            addCheck,
          })
        } else {
          addCheck({
            id: 'provider-installation-path',
            section: 'Provider',
            status: 'unknown',
            label: 'provider installation path',
            message: 'Skipped because --provider was not supplied.',
          })
          addCheck({
            id: 'provider-compatibility',
            section: 'Provider',
            status: 'unknown',
            label: 'provider compatibility',
            message: 'Skipped because --provider was not supplied.',
          })
        }
      } catch (error) {
        addCheck({
          id: 'install-bundle-hashes',
          section: 'Core',
          status: 'fail',
          label: 'install bundle hash/materialization failed',
          message: errorMessage(error),
        })
      } finally {
        if (materializedPluginsRoot) {
          await cleanupMaterializedPlugin(materializedPluginsRoot)
        }
      }
    } else {
      addCheck({
        id: 'install-bundle-hashes',
        section: 'Core',
        status: 'unknown',
        label: 'install bundle hashes',
        message: 'Skipped because the requested plugin could not be resolved.',
      })
      addCheck({
        id: 'smoke-tests',
        section: 'Provider',
        status: 'unknown',
        label: 'smoke tests',
        message: 'Skipped because the requested plugin could not be resolved.',
      })
    }

    addCourseCompatibilityCheck(resolvedBundles, addCheck)
  }

  await addLedgerChecks({
    cwd,
    provider: installProvider,
    resolvedBundles,
    addCheck,
  })

  if (!provider && !args.spec) {
    addCheck({
      id: 'provider-installation-path',
      section: 'Provider',
      status: 'unknown',
      label: 'provider installation path',
      message: 'Skipped because --provider was not supplied.',
    })
    addCheck({
      id: 'provider-compatibility',
      section: 'Provider',
      status: 'unknown',
      label: 'provider compatibility',
      message: 'Skipped because --provider and plugin ref were not supplied.',
    })
    addCheck({
      id: 'mcp-config-presence',
      section: 'Provider',
      status: 'unknown',
      label: 'MCP server config presence',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'required-env-vars',
      section: 'Provider',
      status: 'unknown',
      label: 'required env vars',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'optional-env-vars',
      section: 'Provider',
      status: 'unknown',
      label: 'optional env vars',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'smoke-tests',
      section: 'Provider',
      status: 'unknown',
      label: 'smoke tests',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'stale-verification-date',
      section: 'Capabilities',
      status: 'unknown',
      label: 'stale verification date',
      message: 'Skipped because no plugin ref was provided.',
    })
    addCheck({
      id: 'course-compatibility-metadata',
      section: 'Status',
      status: 'unknown',
      label: 'course compatibility metadata',
      message: 'Skipped because no plugin ref was provided.',
    })
  }

  const hasFail = checks.some((check) => check.status === 'fail')
  const hasWarn = checks.some((check) => check.status === 'warn')
  const exitCode: 0 | 1 = hasFail ? 1 : 0
  const status: DoctorJson['status'] = hasFail ? 'failed' : hasWarn ? 'warning' : 'ready'

  addCheck({
    id: 'doctor-status',
    section: 'Status',
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    label: statusLabel({ spec: args.spec, status }),
  })

  return {
    schemaVersion: 1,
    ok: !hasFail,
    status,
    input,
    versions: {
      cli: cliPackageJson.version,
      sdk: sdkPackageJson.version,
    },
    checks,
    ...(capabilityResolution ? { capabilityResolution: capabilityResolutionToJson(capabilityResolution) } : {}),
    ...(providerPreview ? { provider: providerPreview } : {}),
    exitCode,
  }
}

class RegistryCapabilityPluginLoader implements CapabilityPluginLoader {
  readonly metadataWarnings: DoctorCheck[] = []
  readonly schemaErrors: string[] = []
  private readonly records = new Map<string, LoadedPluginRecord>()
  private readonly loadErrors = new Map<string, string>()

  constructor(private readonly options: {
    cwd: string
    registries: RegistryRef[]
    rootRef: string
  }) {}

  async loadPlugin(ref: string): Promise<CapabilityPluginRecord | null> {
    const spec = this.toRegistrySpec(ref)
    const parsed = parseCapabilityPluginRef(spec)
    const existing = this.records.get(parsed.name)
    if (existing) return existing

    try {
      const bundle = await this.resolveBundle(spec)
      const manifest = await readPluginManifestFromBundle(bundle)
      const trustTier = bundle.listing.registryTrustTier
      const installability = bundle.listing.registryInstallability
      if (!trustTier) {
        this.metadataWarnings.push({
          id: `trust-tier-unknown:${manifest.name}`,
          section: 'Core',
          status: 'unknown',
          label: `${manifest.name} trust tier`,
          message: 'Registry listing did not expose registryTrustTier; treating as listed for required-provider policy.',
        })
      }
      if (!installability) {
        this.metadataWarnings.push({
          id: `registry-installability-unknown:${manifest.name}`,
          section: 'Core',
          status: 'unknown',
          label: `${manifest.name} registry installability`,
          message: 'Registry listing did not expose registryInstallability; derived installability from marketplace availability.',
        })
      }

      const record: LoadedPluginRecord = {
        ref: spec,
        manifest,
        trustTier: trustTier ?? 'listed',
        installability: installability ?? installabilityFromMarketplace(bundle.listing.installability),
        version: bundle.listing.registryVersion ?? bundle.listing.version,
        registryAlias: bundle.listing.registryAlias ?? parsed.registryAlias ?? DEFAULT_REGISTRY_ALIAS,
        registryRef: `${bundle.listing.registryAlias ?? parsed.registryAlias ?? DEFAULT_REGISTRY_ALIAS}/${bundle.listing.artifactId}@${bundle.listing.version}`,
        snapshotDigest: installBundleSnapshotDigest(bundle),
        verification: bundle.controlPlane?.verification,
        providerCompatibility: bundle.controlPlane?.providerCompatibility,
        bundle,
      }
      this.records.set(manifest.name, record)
      return record
    } catch (error) {
      const message = errorMessage(error)
      this.loadErrors.set(parsed.name, message)
      if (/invalid .*plugin\.json|plugin manifest/i.test(message)) this.schemaErrors.push(message)
      return null
    }
  }

  getRecord(pluginName: string) {
    return this.records.get(pluginName)
  }

  getBundles() {
    return [...this.records.values()]
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
      .map((record) => record.bundle)
  }

  getLoadError(pluginName: string) {
    return this.loadErrors.get(pluginName)
  }

  private async resolveBundle(spec: string) {
    return resolvePluginSpec(spec, this.options.cwd, this.options.registries)
  }

  private toRegistrySpec(ref: string) {
    const parts = parseCapabilityPluginRef(ref)
    const rootParts = parseCapabilityPluginRef(this.options.rootRef)
    const registryAlias = parts.registryAlias ?? rootParts.registryAlias ?? DEFAULT_REGISTRY_ALIAS
    const version = parts.requestedVersion
    if (!version) return `${registryAlias}/${parts.name}`
    if (SEMVER_RE.test(version)) return `${registryAlias}/${parts.name}@${version}`

    this.metadataWarnings.push({
      id: `dependency-version-range:${parts.name}:${version}`,
      section: 'Core',
      status: 'unknown',
      label: `${parts.name}@${version}`,
      message: 'Registry resolver only accepts exact semver pins today; Doctor resolved the latest registry version for this range.',
    })
    return `${registryAlias}/${parts.name}`
  }
}

async function readPluginManifestFromBundle(bundle: InstallBundle): Promise<PluginManifest> {
  const manifestFile = bundle.file_list.find((file) => file.path === 'plugin.json')
  if (!manifestFile) {
    throw new Error(`Install bundle ${bundle.listing.artifactId} is missing plugin.json.`)
  }
  const bytes = manifestFile.inline
    ? new Uint8Array(Buffer.from(manifestFile.inline, 'base64'))
    : await readInstallBundleFile(bundle, manifestFile)
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new Error(`Invalid plugin.json in ${bundle.listing.artifactId}: ${errorMessage(error)}`)
  }
  const parsed = PluginManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid plugin.json in ${bundle.listing.artifactId}: ${issue?.message ?? 'invalid data'}`)
  }
  return parsed.data
}

function parseSingleProvider(value: string): CapabilityTarget {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'codex' || normalized === 'claude-code' || normalized === 'cursor') return normalized
  throw new Error('`agentrig doctor --provider` requires a single provider target: codex, claude-code, or cursor.')
}

function providerTargetToPluginProvider(provider: CapabilityTarget): PluginProviderId {
  return provider === 'claude-code' ? 'claude' : provider
}

function addResolvedPluginChecks(
  result: CapabilityResolutionResult,
  addCheck: (check: DoctorCheck) => void
) {
  const blocked = result.blockedYankedProviders
  addCheck({
    id: 'trust-tier',
    section: 'Core',
    status: result.resolvedPlugins.some((plugin) => plugin.trustTier === 'blocked' || plugin.trustTier === 'yanked')
      ? 'fail'
      : result.resolvedPlugins.some((plugin) => plugin.trustTier === 'listed')
        ? 'warn'
        : 'pass',
    label: result.resolvedPlugins.length
      ? `trust tier: ${summarizeTrustTiers(result.resolvedPlugins.map((plugin) => plugin.trustTier))}`
      : 'trust tier',
    message: result.resolvedPlugins.some((plugin) => plugin.trustTier === 'listed')
      ? 'Listed entries are discovery-only for required providers.'
      : undefined,
  })
  addCheck({
    id: 'yanked-blocked-status',
    section: 'Core',
    status: blocked.length ? 'fail' : 'pass',
    label: blocked.length ? 'blocked/yanked provider detected' : 'no yanked/blocked providers',
    message: blocked.map((entry) => entry.message).join('; ') || undefined,
    details: blocked.length ? blocked : undefined,
  })
  const stale = result.staleProviders
  addCheck({
    id: 'stale-verification-date',
    section: 'Capabilities',
    status: stale.length ? 'warn' : 'pass',
    label: stale.length ? 'stale provider verification date' : 'provider verification dates fresh',
    message: stale.map((entry) => entry.message).join('; ') || undefined,
    details: stale.length ? stale : undefined,
  })
}

function addCapabilityProviderChecks(
  result: CapabilityResolutionResult,
  provider: CapabilityTarget | undefined,
  addCheck: (check: DoctorCheck) => void
) {
  if (result.requiredCapabilities.length === 0 && result.optionalCapabilities.length === 0) {
    addCheck({
      id: 'capabilities-none',
      section: 'Capabilities',
      status: 'pass',
      label: 'no external capabilities required',
    })
  }

  const issueWarnings = result.warnings.concat(result.errors.filter((issue) => issue.code === 'stale_provider'))
  for (const issue of issueWarnings) {
    addCheck({
      id: `capability-warning:${issue.code}:${issue.capability ?? ''}:${issue.provider ?? ''}`,
      section: 'Capabilities',
      status: 'warn',
      label: capabilityIssueLabel(issue),
      message: issue.message,
      details: issue,
    })
  }

  for (const chosen of result.chosenProviders) {
    addCheck({
      id: `capability:${chosen.capability}`,
      section: 'Capabilities',
      status: chosen.required ? 'pass' : 'warn',
      label: `${chosen.capability} -> ${chosen.plugin}@${chosen.version ?? 'unknown'}`,
      message: chosen.required ? undefined : 'Optional capability provider; Doctor will not auto-install optional providers.',
    })
  }

  if (!provider) return

  const unsupported = result.chosenProviders.filter((chosen) => chosen.compatibility[provider] === 'unsupported')
  const unknown = result.chosenProviders.filter((chosen) => chosen.compatibility[provider] === 'unknown')
  const supported = result.chosenProviders.filter((chosen) => {
    const state = chosen.compatibility[provider]
    return state === 'native' || state === 'port'
  })

  addCheck({
    id: 'provider-compatibility',
    section: 'Provider',
    status: unsupported.some((chosen) => chosen.required) ? 'fail' : unknown.length ? 'unknown' : 'pass',
    label: providerCompatibilityLabel(provider, supported, unknown, unsupported),
    message: unknown.length
      ? 'Provider compatibility is unknown because the registry control plane did not declare this target.'
      : unsupported.length
        ? `Unsupported provider(s): ${unsupported.map((chosen) => chosen.plugin).join(', ')}`
        : undefined,
  })

  const constraints = result.chosenProviders.flatMap((chosen) => [
    ...(chosen.installConstraints.common ?? []),
    ...(chosen.installConstraints[provider] ?? []),
  ])
  addCheck({
    id: 'provider-install-constraints',
    section: 'Provider',
    status: constraints.length ? 'warn' : 'pass',
    label: constraints.length ? 'provider install constraints declared' : 'no provider install constraints declared',
    message: constraints.join('; ') || undefined,
  })
}

async function addProviderPreviewChecks(args: {
  cwd: string
  provider: CapabilityTarget
  installProvider: PluginProviderId
  pluginsRoot: string
  bundles: InstallBundle[]
  addCheck: (check: DoctorCheck) => void
}) {
  const scope = resolveInstallScope(args.installProvider, 'auto')
  const plan = await preparePluginInstall({
    cwd: args.cwd,
    agent: args.installProvider,
    pluginsDir: args.pluginsRoot,
    installMetadataByPluginId: buildResolvedPluginInstallMetadataMap(args.bundles),
    scope: 'auto',
    force: false,
    dryRun: true,
  })
  const providerPlan = plan.providers.find((item) => item.provider === args.installProvider)
  const previewLocations = providerPlan?.preview.locations ?? []
  args.addCheck({
    id: 'provider-installation-path',
    section: 'Provider',
    status: previewLocations.length ? 'pass' : 'unknown',
    label: previewLocations.length
      ? `${titleProvider(args.provider)} plugin path detected`
      : `${titleProvider(args.provider)} plugin path`,
    message: previewLocations.length ? previewLocations.join(', ') : 'Provider adapter did not expose install preview locations.',
    details: providerPlan?.preview,
  })
  args.addCheck({
    id: 'provider-exact-install-commands',
    section: 'Provider',
    status: providerPlan?.preview.actions.length ? 'pass' : 'unknown',
    label: providerPlan?.preview.actions.length ? 'exact install commands available' : 'exact install commands',
    message: providerPlan?.preview.actions.join('; ') || 'Provider adapter did not expose exact install actions.',
    details: providerPlan?.preview.actions,
  })
  args.addCheck({
    id: 'provider-export-surface',
    section: 'Provider',
    status: previewLocations.length ? 'pass' : 'unknown',
    label: `${titleProvider(args.provider)} export surface`,
    message: providerExportSurfaceMessage(args.provider),
  })
  await addProviderGeneratedExportChecks({
    cwd: args.cwd,
    provider: args.provider,
    installProvider: args.installProvider,
    pluginsRoot: args.pluginsRoot,
    addCheck: args.addCheck,
  })
  return {
    selected: args.provider,
    scope,
    previewLocations,
  } satisfies NonNullable<DoctorJson['provider']>
}

async function addProviderGeneratedExportChecks(args: {
  cwd: string
  provider: CapabilityTarget
  installProvider: PluginProviderId
  pluginsRoot: string
  addCheck: (check: DoctorCheck) => void
}) {
  const exportRoot = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-doctor-provider-export-'))
  try {
    const results = await exportPluginProviders({
      cwd: args.cwd,
      agent: args.installProvider,
      pluginsDir: args.pluginsRoot,
      out: exportRoot,
      clean: true,
    })
    const result = results.find((entry) => entry.provider === args.installProvider)
    if (!result) {
      args.addCheck({
        id: 'provider-generated-files',
        section: 'Provider',
        status: 'fail',
        label: `${titleProvider(args.provider)} generated files missing`,
        message: 'Provider export did not return a result.',
      })
      return
    }
    await addGeneratedFileChecksForProvider(args.provider, args.installProvider, result, args.addCheck)
  } catch (error) {
    args.addCheck({
      id: 'provider-generated-files',
      section: 'Provider',
      status: 'fail',
      label: `${titleProvider(args.provider)} generated files failed`,
      message: errorMessage(error),
    })
  } finally {
    await fs.rm(exportRoot, { recursive: true, force: true }).catch(() => {})
  }
}

async function addGeneratedFileChecksForProvider(
  provider: CapabilityTarget,
  installProvider: PluginProviderId,
  result: ProviderExportResult,
  addCheck: (check: DoctorCheck) => void
) {
  if (provider === 'codex') {
    await addCodexGeneratedFileChecks(result, installProvider, addCheck)
    return
  }
  if (provider === 'claude-code') {
    await addClaudeGeneratedFileChecks(result, installProvider, addCheck)
    return
  }
  await addCursorGeneratedFileChecks(result, installProvider, addCheck)
}

export const __doctorGeneratedFileChecksForTests = {
  addGeneratedFileChecksForProvider,
}

async function addCodexGeneratedFileChecks(
  result: ProviderExportResult,
  installProvider: PluginProviderId,
  addCheck: (check: DoctorCheck) => void
) {
  const summaries = await collectGeneratedPluginSummaries(result.outRoot)
  const expectations = await collectCanonicalProviderExpectations(result, installProvider)
  const missing = expectations.flatMap((plugin) => {
    const summary = summaries.get(plugin.name)
    return [
      ...missingWhen(!summary?.files.has('.codex-plugin/plugin.json'), `${plugin.name}:.codex-plugin/plugin.json`),
      ...missingWhen(!summary?.files.has('AGENTS.md'), `${plugin.name}:AGENTS.md`),
      ...missingWhen(plugin.expectsSkills && !hasGeneratedSkills(summary), `${plugin.name}:skills/`),
      ...missingWhen(plugin.expectsSkills && !summary?.manifest?.skills, `${plugin.name}:skills manifest pointer`),
      ...missingWhen(plugin.expectsMcp && !summary?.manifest?.mcpServers, `${plugin.name}:MCP manifest pointer`),
      ...missingWhen(plugin.expectsMcp && !summary?.files.has('.mcp.json'), `${plugin.name}:.mcp.json`),
      ...missingWhen(plugin.expectsMcp && !mcpConfigHasServers(summary?.mcpJson.get('.mcp.json')), `${plugin.name}:.mcp.json valid MCP config`),
    ]
  })
  const badPointers = expectations
    .filter((plugin) => {
      const pointer = summaries.get(plugin.name)?.text.get('AGENTS.md') ?? ''
      return !/agentrig doctor --provider codex/.test(pointer)
        || !/project-spec-packager/.test(pointer)
        || !/ship-gate/.test(pointer)
        || !/approval|sandbox/i.test(pointer)
        || pointer.split(/\r?\n/).length > 100
    })
    .map((plugin) => `${plugin.name}:AGENTS.md`)
  addCheck({
    id: 'codex-generated-files',
    section: 'Provider',
    status: missing.length || badPointers.length ? 'fail' : 'pass',
    label: missing.length || badPointers.length ? 'Codex generated files incomplete' : 'Codex generated files verified',
    message: [...missing, ...badPointers].join('; ') || undefined,
  })
}

async function addClaudeGeneratedFileChecks(
  result: ProviderExportResult,
  installProvider: PluginProviderId,
  addCheck: (check: DoctorCheck) => void
) {
  const summaries = await collectGeneratedPluginSummaries(result.outRoot)
  const expectations = await collectCanonicalProviderExpectations(result, installProvider)
  const missing = expectations.flatMap((plugin) => {
    const summary = summaries.get(plugin.name)
    return [
      ...missingWhen(!summary?.files.has('.claude-plugin/plugin.json'), `${plugin.name}:.claude-plugin/plugin.json`),
      ...missingWhen(plugin.expectsSkills && !hasGeneratedSkills(summary), `${plugin.name}:skills/`),
      ...missingWhen(plugin.expectsMcp && !summary?.files.has('.mcp.json'), `${plugin.name}:.mcp.json`),
      ...missingWhen(plugin.expectsMcp && !mcpConfigHasServers(summary?.mcpJson.get('.mcp.json')), `${plugin.name}:.mcp.json valid MCP config`),
      ...missingWhen(plugin.expectsMcp && !claudeMcpUsesRequiredVariables(summary?.text.get('.mcp.json')), `${plugin.name}:.mcp.json Claude path variables`),
    ]
  })
  addCheck({
    id: 'claude-generated-files',
    section: 'Provider',
    status: missing.length ? 'fail' : 'pass',
    label: missing.length
      ? 'Claude Code generated files incomplete'
      : 'Claude Code generated files verified',
    message: missing.join('; ') || undefined,
  })
}

async function addCursorGeneratedFileChecks(
  result: ProviderExportResult,
  installProvider: PluginProviderId,
  addCheck: (check: DoctorCheck) => void
) {
  const summaries = await collectGeneratedPluginSummaries(result.outRoot)
  const expectations = await collectCanonicalProviderExpectations(result, installProvider)
  const missing = expectations.flatMap((plugin) => {
    const summary = summaries.get(plugin.name)
    return [
      ...missingWhen(!summary?.files.has('.cursor-plugin/plugin.json'), `${plugin.name}:.cursor-plugin/plugin.json`),
      ...missingWhen(!summary?.files.has('CURSOR.md'), `${plugin.name}:CURSOR.md`),
      ...missingWhen(!summary?.files.has('rules/agentrig-provider.mdc'), `${plugin.name}:rules/agentrig-provider.mdc`),
      ...missingWhen(plugin.expectsSkills && !hasGeneratedSkills(summary), `${plugin.name}:skills/`),
      ...missingWhen(plugin.expectsSkills && !summary?.manifest?.skills, `${plugin.name}:skills manifest pointer`),
      ...missingWhen(plugin.expectsMcp && !summary?.manifest?.mcpServers, `${plugin.name}:MCP manifest pointer`),
      ...missingWhen(plugin.expectsMcp && !summary?.files.has('mcp.json'), `${plugin.name}:mcp.json`),
      ...missingWhen(plugin.expectsMcp && !mcpConfigHasServers(summary?.mcpJson.get('mcp.json')), `${plugin.name}:mcp.json valid MCP config`),
    ]
  })
  const badPointers = expectations
    .filter((plugin) => {
      const summary = summaries.get(plugin.name)
      const notes = summary?.text.get('CURSOR.md') ?? ''
      const rule = summary?.text.get('rules/agentrig-provider.mdc') ?? ''
      return !/agentrig doctor --provider cursor/.test(notes)
        || !/provider-neutral/i.test(rule)
        || !/project-spec-packager/.test(rule)
        || !/ship-gate/.test(rule)
    })
    .map((plugin) => `${plugin.name}:CURSOR.md/rules`)
  addCheck({
    id: 'cursor-generated-files',
    section: 'Provider',
    status: missing.length || badPointers.length ? 'fail' : 'pass',
    label: missing.length || badPointers.length ? 'Cursor generated files incomplete' : 'Cursor generated files verified',
    message: [...missing, ...badPointers].join('; ') || undefined,
  })
}

type CanonicalProviderExpectation = {
  name: string
  expectsSkills: boolean
  expectsMcp: boolean
}

type GeneratedPluginSummary = {
  name: string
  files: Set<string>
  text: Map<string, string>
  mcpJson: Map<string, Record<string, unknown>>
  manifest?: Record<string, unknown>
}

async function collectCanonicalProviderExpectations(
  result: ProviderExportResult,
  installProvider: PluginProviderId
): Promise<CanonicalProviderExpectation[]> {
  const expectations = await Promise.all(result.plugins.map(async (plugin) => {
    const pluginPrefix = plugin.pluginName.endsWith(plugin.manifest.name)
      ? plugin.pluginName.slice(0, -plugin.manifest.name.length)
      : undefined
    return {
      name: providerPluginName(plugin, installProvider, pluginPrefix),
      expectsSkills: await pathExists(path.join(plugin.pluginSourceDir, 'skills')),
      expectsMcp: await sourceHasMcpConfig(plugin.pluginSourceDir),
    } satisfies CanonicalProviderExpectation
  }))
  return expectations.sort((left, right) => left.name.localeCompare(right.name))
}

async function collectGeneratedPluginSummaries(outRoot: string) {
  const pluginsRoot = path.join(outRoot, 'plugins')
  const entries = await fs.readdir(pluginsRoot, { withFileTypes: true })
  const summaries = new Map<string, GeneratedPluginSummary>()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pluginRoot = path.join(pluginsRoot, entry.name)
    const files = await walkRelativeFiles(pluginRoot)
    const text = new Map<string, string>()
    for (const relativePath of ['AGENTS.md', 'CLAUDE.md', 'CURSOR.md', 'rules/agentrig-provider.mdc', '.mcp.json', 'mcp.json']) {
      if (!files.has(relativePath)) continue
      const content = await fs.readFile(path.join(pluginRoot, relativePath), 'utf-8').catch(() => undefined)
      if (content !== undefined) text.set(relativePath, content)
    }
    const mcpJson = new Map<string, Record<string, unknown>>()
    for (const relativePath of ['.mcp.json', 'mcp.json']) {
      if (!files.has(relativePath)) continue
      const raw = await readJsonFile<unknown>(path.join(pluginRoot, relativePath)).catch(() => null)
      if (isRecord(raw)) mcpJson.set(relativePath, raw)
    }
    summaries.set(entry.name, {
      name: entry.name,
      files,
      text,
      mcpJson,
      manifest: await firstPluginManifest(pluginRoot),
    })
  }

  return summaries
}

async function sourceHasMcpConfig(pluginSourceDir: string) {
  for (const relativePath of ['.mcp.json', 'mcp.json']) {
    const raw = await readJsonFile<unknown>(path.join(pluginSourceDir, relativePath))
    if (mcpConfigHasServers(raw)) return true
  }
  return false
}

function hasGeneratedSkills(summary: GeneratedPluginSummary | undefined) {
  return Boolean(summary && [...summary.files].some((file) => file.startsWith('skills/')))
}

function mcpConfigHasServers(config: unknown) {
  if (!isRecord(config)) return false
  const servers = toRecord(config.mcpServers) ?? toRecord(config.servers)
  return Boolean(servers && Object.keys(servers).length > 0)
}

function claudeMcpUsesRequiredVariables(content: string | undefined) {
  if (!content) return false
  return ['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_PROJECT_DIR']
    .every((name) => content.includes(`\${${name}}`))
}

async function firstPluginManifest(pluginRoot: string): Promise<Record<string, unknown> | undefined> {
  for (const relativePath of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.cursor-plugin/plugin.json',
  ]) {
    const raw = await readJsonFile<unknown>(path.join(pluginRoot, relativePath))
    if (isRecord(raw)) return raw
  }
  return undefined
}

async function walkRelativeFiles(root: string, current = root): Promise<Set<string>> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files = new Set<string>()
  for (const entry of entries) {
    const next = path.join(current, entry.name)
    if (entry.isDirectory()) {
      const childFiles = await walkRelativeFiles(root, next)
      for (const child of childFiles) files.add(child)
      continue
    }
    if (entry.isFile()) {
      files.add(path.relative(root, next).split(path.sep).join('/'))
    }
  }
  return files
}

function missingWhen(condition: boolean, label: string) {
  return condition ? [label] : []
}

async function addSmokeTestChecks(
  pluginsRoot: string,
  chosenProviders: CapabilityChosenProvider[],
  addCheck: (check: DoctorCheck) => void
) {
  const smokeTests = chosenProviders
    .map((provider) => ({
      plugin: provider.plugin,
      smokeTest: provider.verification?.smokeTest,
    }))
    .filter((entry): entry is { plugin: string; smokeTest: string } => Boolean(entry.smokeTest))

  if (!smokeTests.length) {
    addCheck({
      id: 'smoke-tests',
      section: 'Provider',
      status: 'unknown',
      label: 'smoke tests',
      message: 'No control-plane verification smoke test was declared by chosen providers.',
    })
    return
  }

  const missing: string[] = []
  for (const entry of smokeTests) {
    const smokePath = path.join(pluginsRoot, entry.plugin, entry.smokeTest)
    if (!(await pathExists(smokePath))) missing.push(`${entry.plugin}:${entry.smokeTest}`)
  }

  addCheck({
    id: 'smoke-tests',
    section: 'Provider',
    status: missing.length ? 'fail' : 'pass',
    label: missing.length ? 'required smoke tests missing' : 'required smoke tests present',
    message: missing.join('; ') || undefined,
  })
}

async function addMcpAndEnvChecks(
  pluginsRoot: string,
  chosenProviders: CapabilityChosenProvider[],
  addCheck: (check: DoctorCheck) => void
) {
  const pluginNames = chosenProviders.map((provider) => provider.plugin)
  const mcpConfigs = await collectMcpConfigs(pluginsRoot, pluginNames)
  const extensions = await collectPluginExtensions(pluginsRoot, pluginNames)
  addCheck({
    id: 'mcp-config-presence',
    section: 'Provider',
    status: mcpConfigs.length ? 'pass' : 'pass',
    label: mcpConfigs.length ? 'MCP server config present' : 'no MCP server config required',
    message: mcpConfigs.map((entry) => `${entry.plugin}:${entry.relativePath}`).join(', ') || undefined,
  })

  const declaredEnv = collectDeclaredEnv(chosenProviders, mcpConfigs, extensions)
  addEnvCheck('required-env-vars', 'required env vars', declaredEnv.required, true, addCheck)
  addEnvCheck('optional-env-vars', 'optional env vars', declaredEnv.optional, false, addCheck)
  await addProviderSecurityChecks(chosenProviders, mcpConfigs, extensions, addCheck)

  for (const provider of chosenProviders) {
    if (provider.required) continue
    addCheck({
      id: `security-optional-provider:${provider.plugin}`,
      section: 'Capabilities',
      status: 'warn',
      label: `${provider.plugin} is optional`,
      message: 'Capability provider is optional; Doctor will not silently install it.',
    })
  }

  for (const provider of chosenProviders) {
    const extension = extensions.get(provider.plugin) ?? {}
    if (requiresPaidAccount(extension)) {
      addCheck({
        id: `security-paid-provider:${provider.plugin}`,
        section: 'Provider',
        status: 'warn',
        label: `${provider.plugin} requires a paid account`,
        message: 'Provider metadata indicates a paid/cloud account requirement.',
      })
    }
    if (writesToRepoOrExternal(extension)) {
      addCheck({
        id: `security-write-provider:${provider.plugin}`,
        section: 'Provider',
        status: 'warn',
        label: `${provider.plugin} can write to repo or external systems`,
        message: 'Provider permissions indicate write-capable tools; review before use.',
      })
    }
  }
}

async function collectMcpConfigs(pluginsRoot: string, pluginNames: string[]) {
  const configs: Array<{
    plugin: string
    relativePath: string
    json: Record<string, unknown>
  }> = []

  for (const plugin of pluginNames) {
    for (const relativePath of ['.mcp.json', 'mcp.json']) {
      const configPath = path.join(pluginsRoot, plugin, relativePath)
      const raw = await readJsonFile<unknown>(configPath)
      if (!raw || !isRecord(raw)) continue
      if (isRecord(raw.mcpServers) || isRecord(raw.servers)) {
        configs.push({ plugin, relativePath, json: raw })
      }
    }
  }

  return configs
}

async function collectPluginExtensions(pluginsRoot: string, pluginNames: string[]) {
  const extensions = new Map<string, Record<string, unknown>>()
  for (const plugin of pluginNames) {
    const raw = await readJsonFile<unknown>(path.join(pluginsRoot, plugin, 'plugin.json'))
    const parsed = PluginManifestSchema.safeParse(raw)
    if (!parsed.success) continue
    extensions.set(plugin, (agentRigPluginExtension(parsed.data) as Record<string, unknown> | undefined) ?? {})
  }
  return extensions
}

function collectDeclaredEnv(
  chosenProviders: CapabilityChosenProvider[],
  mcpConfigs: Awaited<ReturnType<typeof collectMcpConfigs>>,
  extensions: Awaited<ReturnType<typeof collectPluginExtensions>>
) {
  const required = new Set<string>()
  const optional = new Set<string>()

  for (const provider of chosenProviders) {
    const extension = extensions.get(provider.plugin) ?? {}
    collectEnvFromExtension(extension, required, optional)
  }

  for (const config of mcpConfigs) {
    const servers = toRecord(config.json.mcpServers) ?? toRecord(config.json.servers) ?? {}
    for (const server of Object.values(servers)) {
      const env = toRecord(toRecord(server)?.env)
      if (!env) continue
      for (const key of Object.keys(env)) required.add(key)
    }
  }

  return {
    required: [...required].sort(),
    optional: [...optional].sort(),
  }
}

function collectEnvFromExtension(extension: Record<string, unknown>, required: Set<string>, optional: Set<string>) {
  for (const key of ['requiredEnv', 'requiredEnvVars']) {
    for (const value of stringArray(extension[key])) required.add(value)
  }
  for (const key of ['optionalEnv', 'optionalEnvVars']) {
    for (const value of stringArray(extension[key])) optional.add(value)
  }

  const env = toRecord(extension.env) ?? toRecord(extension.envVars)
  if (env) {
    for (const value of stringArray(env.required)) required.add(value)
    for (const value of stringArray(env.optional)) optional.add(value)
  }

  const security = toRecord(extension.security)
  if (security) {
    for (const value of stringArray(security.requiresEnvVars)) required.add(value)
  }
}

function addEnvCheck(
  id: string,
  label: string,
  vars: string[],
  required: boolean,
  addCheck: (check: DoctorCheck) => void
) {
  if (!vars.length) {
    addCheck({
      id,
      section: 'Provider',
      status: 'pass',
      label: `no ${label} declared`,
    })
    return
  }

  const missing = vars.filter((name) => !process.env[name]?.trim())
  addCheck({
    id,
    section: 'Provider',
    status: missing.length ? required ? 'fail' : 'warn' : 'pass',
    label: missing.length ? `missing ${label}` : `${label} present`,
    message: missing.length ? missing.join(', ') : vars.join(', '),
  })
}

async function addProviderSecurityChecks(
  chosenProviders: CapabilityChosenProvider[],
  mcpConfigs: Awaited<ReturnType<typeof collectMcpConfigs>>,
  extensions: Awaited<ReturnType<typeof collectPluginExtensions>>,
  addCheck: (check: DoctorCheck) => void
) {
  const requiredProviders = chosenProviders.filter((provider) => provider.required)
  for (const provider of requiredProviders) {
    const extension = extensions.get(provider.plugin) ?? {}
    const security = toRecord(extension.security)
    addCheck({
      id: `provider-security:${provider.plugin}`,
      section: 'Provider',
      status: security?.requiresConsent === true && security.showsExactCommands === true ? 'pass' : 'fail',
      label: `${provider.plugin} security metadata`,
      message: security
        ? 'Required providers must set security.requiresConsent=true and security.showsExactCommands=true.'
        : 'Required provider is missing extensions["ai.agentrig"].security metadata.',
      details: security,
    })
  }

  await addInstallCommandFingerprintChecks(requiredProviders, mcpConfigs, extensions, addCheck)

  const unverifiedLocalCommands = mcpConfigs.flatMap((config) => localMcpCommandNames(config.json)
    .filter(() => {
      const security = toRecord(extensions.get(config.plugin)?.security)
      return security?.showsExactCommands !== true
    })
    .map((name) => `${config.plugin}:${name}`))
  addCheck({
    id: 'mcp-local-command-verification',
    section: 'Provider',
    status: unverifiedLocalCommands.length ? 'fail' : 'pass',
    label: unverifiedLocalCommands.length ? 'unverified local MCP commands' : 'local MCP commands verified',
    message: unverifiedLocalCommands.join(', ') || undefined,
  })

  const broadGithubAll = requiredProviders
    .filter((provider) => provider.plugin === 'third-party.github-mcp')
    .filter((provider) => providerUsesGithubAll(extensions.get(provider.plugin), mcpConfigs))
    .map((provider) => provider.plugin)
  addCheck({
    id: 'mcp-github-toolsets',
    section: 'Provider',
    status: broadGithubAll.length ? 'fail' : 'pass',
    label: broadGithubAll.length ? 'broad GitHub all toolset requested' : 'no broad GitHub all toolset',
    message: broadGithubAll.join(', ') || undefined,
  })

  const broadScopes = requiredProviders
    .filter((provider) => hasBroadScopes(extensions.get(provider.plugin)))
    .map((provider) => provider.plugin)
  addCheck({
    id: 'approval-sandbox-warnings',
    section: 'Provider',
    status: broadScopes.length ? 'warn' : 'pass',
    label: broadScopes.length ? 'approval/sandbox review needed' : 'approval/sandbox metadata acceptable',
    message: broadScopes.join(', ') || undefined,
  })
}

async function addInstallCommandFingerprintChecks(
  requiredProviders: CapabilityChosenProvider[],
  mcpConfigs: Awaited<ReturnType<typeof collectMcpConfigs>>,
  extensions: Awaited<ReturnType<typeof collectPluginExtensions>>,
  addCheck: (check: DoctorCheck) => void
) {
  const failures: Array<{
    plugin: string
    expected?: string
    actual?: string
    reason: string
  }> = []

  for (const provider of requiredProviders) {
    const extension = extensions.get(provider.plugin) ?? {}
    const expected = provider.verification?.commandFingerprint?.trim()
    const sources = [
      extension,
      ...mcpConfigs
        .filter((config) => config.plugin === provider.plugin)
        .map((config) => config.json),
    ]
    const actual = await agentRigInstallCommandFingerprint(sources)
    if (!actual && !expected) continue
    if (!expected) {
      failures.push({
        plugin: provider.plugin,
        actual,
        reason: 'missing control-plane verification command fingerprint',
      })
      continue
    }
    if (actual !== expected) {
      failures.push({
        plugin: provider.plugin,
        expected,
        actual,
        reason: 'install command changed since last verification',
      })
    }
  }

  addCheck({
    id: 'provider-install-command-fingerprint',
    section: 'Provider',
    status: failures.length ? 'fail' : 'pass',
    label: failures.length ? 'provider install command fingerprint changed' : 'provider install command fingerprints verified',
    message: failures.map((failure) => `${failure.plugin}: ${failure.reason}`).join('; ') || undefined,
    details: failures.length ? failures : undefined,
  })
}

function localMcpCommandNames(config: Record<string, unknown>) {
  const servers = toRecord(config.mcpServers) ?? toRecord(config.servers) ?? {}
  return Object.entries(servers)
    .filter(([, server]) => {
      const command = toRecord(server)?.command
      return typeof command === 'string' && command.trim().length > 0
    })
    .map(([name]) => name)
    .sort()
}

function providerUsesGithubAll(
  extension: Record<string, unknown> | undefined,
  mcpConfigs: Awaited<ReturnType<typeof collectMcpConfigs>>
) {
  const values = [
    ...stringArray(extension?.toolsets),
    ...stringArray(extension?.defaultToolsets),
    ...stringArray(toRecord(extension?.github)?.toolsets),
    ...stringArray(toRecord(extension?.permissions)?.defaultToolsets),
    ...mcpConfigs.flatMap((config) => stringArray(config.json.toolsets)),
  ]
  return values.some((value) => value.trim().toLowerCase() === 'all')
}

function hasBroadScopes(extension: Record<string, unknown> | undefined) {
  if (!extension) return false
  const security = toRecord(extension.security)
  const haystack = [
    ...stringArray(extension.permissions),
    ...stringArray(extension.scopes),
    ...stringArray(extension.fileScopes),
    ...stringArray(extension.networkScopes),
    ...stringArray(toRecord(security?.permissions)?.scopes),
    ...stringArray(security?.notes),
  ].join(' ').toLowerCase()
  return /\ball\b|\bhome\b|~\/|\bssh\b|\bsudo\b|rm -rf|curl\s*\|/.test(haystack)
}

async function addLedgerChecks(args: {
  cwd: string
  provider: PluginProviderId | undefined
  resolvedBundles: InstallBundle[]
  addCheck: (check: DoctorCheck) => void
}) {
  let ledgers: Awaited<ReturnType<typeof loadPluginInstallLedgers>>
  try {
    ledgers = await loadPluginInstallLedgers(args.cwd)
  } catch (error) {
    args.addCheck({
      id: 'install-ledger',
      section: 'Core',
      status: 'fail',
      label: 'install ledger unreadable',
      message: errorMessage(error),
    })
    args.addCheck({
      id: 'hash-owned-json-writes',
      section: 'Provider',
      status: 'unknown',
      label: 'hash-owned JSON writes',
      message: 'Skipped because install ledgers could not be read.',
    })
    return
  }

  if (!args.provider) {
    args.addCheck({
      id: 'install-ledger',
      section: 'Core',
      status: 'pass',
      label: 'install ledgers readable',
    })
    await addJsonOwnershipChecks(ledgers, undefined, args.addCheck)
    return
  }

  const scope = resolveInstallScope(args.provider, 'auto')
  const records = listPluginInstallRecords(ledgers, scope).filter(
    (record) => record.provider === args.provider && record.scope === scope
  )

  if (!args.resolvedBundles.length) {
    args.addCheck({
      id: 'install-ledger',
      section: 'Core',
      status: records.length ? 'pass' : 'unknown',
      label: records.length ? `${titleProvider(args.provider)} install ledger present` : `${titleProvider(args.provider)} install ledger`,
      message: records.length ? undefined : 'No plugin ref was supplied, so Doctor only checked that ledgers are readable.',
    })
    await addJsonOwnershipChecks(ledgers, args.provider, args.addCheck)
    return
  }

  const expectedPlugins = args.resolvedBundles.map((bundle) => bundle.listing.artifactId).sort()
  const missing = expectedPlugins.filter((pluginId) => !records.some((record) => record.pluginId === pluginId))
  const stalePaths = await missingTargetPaths(records)
  args.addCheck({
    id: 'install-ledger',
    section: 'Core',
    status: missing.length || stalePaths.length ? 'fail' : 'pass',
    label: missing.length || stalePaths.length ? 'install ledger incomplete' : `${titleProvider(args.provider)} install ledger matches resolved plugins`,
    message: [
      missing.length ? `Missing ledger records: ${missing.join(', ')}` : '',
      stalePaths.length ? `Missing target paths: ${stalePaths.join(', ')}` : '',
    ].filter(Boolean).join('; ') || undefined,
  })
  await addJsonOwnershipChecks(ledgers, args.provider, args.addCheck)
}

async function addJsonOwnershipChecks(
  ledgers: Awaited<ReturnType<typeof loadPluginInstallLedgers>>,
  provider: PluginProviderId | undefined,
  addCheck: (check: DoctorCheck) => void
) {
  const selectionRecords = listSelectionInstallRecords(ledgers)
    .filter((record) => !provider || record.provider === provider)
    .filter((record) => record.jsonWrites.length > 0)
  if (!selectionRecords.length) {
    addCheck({
      id: 'hash-owned-json-writes',
      section: 'Provider',
      status: 'pass',
      label: 'no hash-owned JSON writes recorded',
    })
    return
  }

  const kept: string[] = []
  const missing: string[] = []
  for (const record of selectionRecords) {
    const result = await validateSelectionJsonWrites(record)
    kept.push(...result.kept)
    missing.push(...result.missing)
  }

  addCheck({
    id: 'hash-owned-json-writes',
    section: 'Provider',
    status: kept.length ? 'warn' : missing.length ? 'warn' : 'pass',
    label: kept.length
      ? 'hash-owned JSON writes modified'
      : missing.length
        ? 'hash-owned JSON writes missing'
        : 'hash-owned JSON writes intact',
    message: [...kept, ...missing].join('; ') || undefined,
  })
}

async function validateSelectionJsonWrites(record: SelectionInstallRecord) {
  const kept: string[] = []
  const missing: string[] = []
  for (const write of record.jsonWrites) {
    const raw = await readJsonFile<unknown>(write.path)
    const json = toRecord(raw)
    if (!json) {
      missing.push(`${write.path}:${write.keyPath}`)
      continue
    }
    const target = write.keyPath === '$' ? json : toRecord(json[write.keyPath])
    if (!target) {
      missing.push(`${write.path}:${write.keyPath}`)
      continue
    }
    const ownedSubset = Object.fromEntries((write.keys ?? []).filter((key) => key in target).map((key) => [key, target[key]]))
    if (digestJson(ownedSubset) !== write.writtenValueSha256) {
      kept.push(`${write.path}:${write.keyPath}`)
    }
  }
  return { kept, missing }
}

async function missingTargetPaths(records: PluginInstallRecord[]) {
  const missing: string[] = []
  for (const record of records) {
    for (const targetPath of record.targetPaths) {
      if (!(await pathExists(targetPath))) missing.push(targetPath)
    }
  }
  return missing
}

function addCourseCompatibilityCheck(
  bundles: InstallBundle[],
  addCheck: (check: DoctorCheck) => void
) {
  if (!bundles.length) {
    addCheck({
      id: 'course-compatibility-metadata',
      section: 'Status',
      status: 'unknown',
      label: 'course compatibility metadata',
      message: 'Skipped because no registry plugins were resolved.',
    })
    return
  }

  const projectBundles = bundles.filter((bundle) => {
    const manifest = getInlineManifestIfAvailable(bundle)
    return manifest ? agentRigPluginExtension(manifest)?.profile === 'project' : false
  })
  addCheck({
    id: 'course-compatibility-metadata',
    section: 'Status',
    status: 'pass',
    label: 'course compatibility not required by Agent Plugins v1',
    message: projectBundles.length
      ? 'Agent Plugins v1 and the ai.agentrig extension do not currently define course compatibility metadata.'
      : 'No project-profile plugin requires course compatibility metadata.',
  })
}

function getInlineManifestIfAvailable(bundle: InstallBundle): PluginManifest | undefined {
  const manifestFile = bundle.file_list.find((file) => file.path === 'plugin.json' && file.inline)
  if (!manifestFile?.inline) return undefined
  try {
    const raw = JSON.parse(Buffer.from(manifestFile.inline, 'base64').toString('utf-8')) as unknown
    return PluginManifestSchema.parse(raw)
  } catch {
    return undefined
  }
}

function formatDoctorReport(result: DoctorJson) {
  const title = `AgentRig Doctor - ${result.input.spec ? shortPluginName(result.input.spec) : 'local'} / ${result.input.provider ?? 'all providers'}`
  const sections: DoctorSection[] = ['Core', 'Capabilities', 'Provider', 'Status']
  const lines = [title, '']

  for (const section of sections) {
    const checks = result.checks.filter((check) => check.section === section)
    if (!checks.length) continue
    lines.push(`${section}:`)
    for (const check of checks) {
      const suffix = check.message ? ` (${check.message})` : ''
      lines.push(`${marker(check.status)} ${check.label}${suffix}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function marker(status: DoctorStatus) {
  if (status === 'pass') return '✓'
  if (status === 'fail') return '✗'
  return '○'
}

function statusLabel(input: { spec?: string; status: DoctorJson['status'] }) {
  if (input.status === 'failed') return 'Not ready; hard failures must be fixed.'
  if (input.status === 'warning') return `Ready with warnings${input.spec ? ` for ${shortPluginName(input.spec)} workflow` : ''}.`
  return `Ready${input.spec ? ` for ${humanWorkflowName(shortPluginName(input.spec))} workflow` : ''}.`
}

function shortPluginName(spec: string) {
  try {
    return parseRegistryPluginSpec(spec).plugin
  } catch {
    return parseCapabilityPluginRef(spec).name
  }
}

function humanWorkflowName(plugin: string) {
  return plugin
    .replace(/^instructa\./, 'Instructa ')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function summarizeTrustTiers(tiers: TrustTier[]) {
  return [...new Set(tiers)].sort().join(', ')
}

function installabilityFromMarketplace(installability: string): RegistryInstallability {
  if (installability === 'yanked') return 'yanked'
  if (installability === 'taken_down') return 'blocked'
  return 'installable'
}

function firstIssueMessage(issues: CapabilityResolutionIssue[]) {
  return issues[0]?.message
}

function capabilityIssueLabel(issue: CapabilityResolutionIssue) {
  if (issue.capability && issue.provider) return `${issue.capability} -> ${issue.provider}`
  if (issue.capability) return issue.capability
  return issue.code.replace(/_/g, ' ')
}

function providerCompatibilityLabel(
  provider: CapabilityTarget,
  supported: CapabilityChosenProvider[],
  unknown: CapabilityChosenProvider[],
  unsupported: CapabilityChosenProvider[]
) {
  if (unsupported.length) return `${titleProvider(provider)} compatibility unsupported`
  if (unknown.length) return `${titleProvider(provider)} compatibility unknown`
  if (supported.length) return `${titleProvider(provider)} provider compatibility declared`
  return `${titleProvider(provider)} provider compatibility`
}

function providerExportSurfaceMessage(provider: CapabilityTarget) {
  if (provider === 'codex') return 'Codex plugin export preview includes marketplace locations and install actions; AGENTS.md pointer presence is tracked by provider adapter output.'
  if (provider === 'claude-code') return 'Claude Code plugin export preview includes marketplace locations and install actions; provider-native manifest, skills, MCP, and reload visibility remain host-state checks.'
  return 'Cursor plugin export preview includes plugin/rules locations and copy actions.'
}

function titleProvider(provider: CapabilityTarget | PluginProviderId) {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude' || provider === 'claude-code') return 'Claude Code'
  return 'Cursor'
}

function requiresPaidAccount(extension: Record<string, unknown>) {
  return extension.requiresPaidAccount === true
    || extension.paidAccountRequired === true
    || extension.accountRequired === 'paid'
    || extension.billing === 'paid'
    || extension.pricing === 'paid'
}

function writesToRepoOrExternal(extension: Record<string, unknown>) {
  if (extension.writesToRepo === true || extension.writesToExternalSystem === true) return true
  const permissions = [
    ...stringArray(extension.permissions),
    ...stringArray(extension.permissionLevel),
    ...stringArray(extension.dataAccessScope),
    ...stringArray(toRecord(extension.security)?.notes),
  ].join(' ').toLowerCase()
  return /\bwrite\b|\bmutate\b|\bdelete\b|\bdeploy\b/.test(permissions)
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(toRecord(value))
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
