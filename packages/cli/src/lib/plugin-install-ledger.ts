import path from 'node:path'
import { z } from 'zod'
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from './fs'
import { getAgentRigHome } from './paths'
import { codexMarketplacePluginSchema } from './plugin-providers/schemas'
import type {
  PluginInstallLedger,
  PluginInstallRecord,
  PluginInstallScopeName,
  PluginInstallScopeSelectorName,
  SelectionInstallRecord,
} from './types'

export const LEDGER_SCHEMA_VERSION = 4

const pluginProviderSchema = z.enum(['claude', 'codex', 'cursor'])
const pluginInstallScopeSchema = z.enum(['personal', 'workspace'])
const pluginInstallScopeSelectorSchema = z.enum(['auto', 'personal', 'workspace'])
const registryPluginInstallSpecIdentitySchema = z.strictObject({
  kind: z.literal('registry'),
  registryAlias: z.string().min(1),
  registryUrl: z.string().min(1),
  pluginId: z.string().min(1),
  version: z.string().min(1),
})
const externalRepoPluginInstallSpecIdentitySchema = z.strictObject({
  kind: z.literal('external-repo'),
  repoUrl: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  commitSha: z.string().min(1).optional(),
  subdir: z.string().min(1).optional(),
  scanDigest: z.string().min(1),
  pickedSignalPaths: z.array(z.string().min(1)),
  pluginId: z.string().min(1),
  version: z.string().min(1),
})
const registryArtifactInstallSpecIdentitySchema = z.strictObject({
  kind: z.literal('registry-artifact'),
  registryAlias: z.string().min(1),
  registryUrl: z.string().min(1),
  artifactKind: z.enum(['skill', 'mcp', 'hook']),
  artifactId: z.string().min(1),
  version: z.string().min(1),
})
const pluginInstallSpecIdentitySchema = z.discriminatedUnion('kind', [
  registryPluginInstallSpecIdentitySchema,
  externalRepoPluginInstallSpecIdentitySchema,
  registryArtifactInstallSpecIdentitySchema,
])
const verifiedRegistryIdentitySchema = z.strictObject({
  registryAlias: z.string().min(1),
  registryUrl: z.string().min(1),
  sourceRepository: z.string().min(1),
  contractVersion: z.string().min(1),
  generatedAt: z.string().min(1),
  signature: z.strictObject({
    algorithm: z.string().min(1),
    keyId: z.string().min(1),
    signedDigest: z.string().min(1),
  }),
})
const pluginInstalledFileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().min(1),
})
const pluginJsonWriteSchema = z.strictObject({
  path: z.string().min(1),
  keyPath: z.string().min(1),
  writtenValueSha256: z.string().min(1),
  previousValueSha256: z.string().min(1).optional(),
  keys: z.array(z.string().min(1)).optional(),
})
const pluginInstallRecordBaseSchema = z.strictObject({
  id: z.string().min(1),
  provider: pluginProviderSchema,
  requestedScope: pluginInstallScopeSelectorSchema,
  specIdentity: pluginInstallSpecIdentitySchema,
  registry: verifiedRegistryIdentitySchema.optional(),
  scope: pluginInstallScopeSchema,
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1),
  snapshotDigest: z.string().min(1),
  pluginName: z.string().min(1),
  targetPaths: z.array(z.string().min(1)),
  installedAt: z.string().min(1),
})
const claudePluginInstallRecordSchema = pluginInstallRecordBaseSchema.extend({
  provider: z.literal('claude'),
  files: z.tuple([]),
  metadata: z.strictObject({
    marketplaceName: z.string().min(1),
    pluginRef: z.string().min(1),
    scopeArg: z.enum(['user', 'project']),
    marketplaceSourcePath: z.string().min(1),
    marketplaceAdded: z.boolean(),
  }),
})
const codexPluginInstallRecordSchema = pluginInstallRecordBaseSchema.extend({
  provider: z.literal('codex'),
  files: z.array(pluginInstalledFileSchema),
  metadata: z.strictObject({
    pluginPath: z.string().min(1),
    marketplacePath: z.string().min(1),
    marketplaceEntry: codexMarketplacePluginSchema,
    marketplaceName: z.string().min(1).optional(),
    pluginRef: z.string().min(1).optional(),
    appServerInstalled: z.boolean().optional(),
  }),
})
const cursorPluginInstallRecordSchema = pluginInstallRecordBaseSchema.extend({
  provider: z.literal('cursor'),
  files: z.array(pluginInstalledFileSchema),
  metadata: z.strictObject({
    pluginPath: z.string().min(1),
  }),
})
const pluginInstallRecordSchema = z.discriminatedUnion('provider', [
  claudePluginInstallRecordSchema,
  codexPluginInstallRecordSchema,
  cursorPluginInstallRecordSchema,
]).superRefine((record, ctx) => {
  if (record.specIdentity.kind === 'registry' && !record.registry) {
    ctx.addIssue({
      code: 'custom',
      message: 'Registry install records require verified registry metadata',
      path: ['registry'],
    })
  }
  if (record.specIdentity.kind === 'external-repo' && record.registry) {
    ctx.addIssue({
      code: 'custom',
      message: 'External repo install records must not include registry metadata',
      path: ['registry'],
    })
  }
})
const selectionInstallRecordSchema = z.strictObject({
  id: z.string().min(1),
  provider: pluginProviderSchema,
  requestedScope: pluginInstallScopeSelectorSchema,
  specIdentity: pluginInstallSpecIdentitySchema,
  registry: verifiedRegistryIdentitySchema.optional(),
  scope: pluginInstallScopeSchema,
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1),
  snapshotDigest: z.string().min(1),
  selectionId: z.string().min(1),
  selectedSelectors: z.array(z.string().min(1)),
  targetPaths: z.array(z.string().min(1)),
  installedAt: z.string().min(1),
  files: z.array(pluginInstalledFileSchema),
  jsonWrites: z.array(pluginJsonWriteSchema),
}).superRefine((record, ctx) => {
  if (record.specIdentity.kind === 'registry' && !record.registry) {
    ctx.addIssue({
      code: 'custom',
      message: 'Registry selection records require verified registry metadata',
      path: ['registry'],
    })
  }
  if (record.specIdentity.kind === 'external-repo' && record.registry) {
    ctx.addIssue({
      code: 'custom',
      message: 'External repo selection records must not include registry metadata',
      path: ['registry'],
    })
  }
})
const pluginInstallLedgerSchema = z.strictObject({
  schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
  installs: z.record(z.string(), pluginInstallRecordSchema),
  selections: z.record(z.string(), selectionInstallRecordSchema),
})

function getCutOverPluginInstallLedgerBackupPath(ledgerPath: string) {
  const parsed = path.parse(ledgerPath)
  return path.join(parsed.dir, `${parsed.name}.pre-openplugins-backup${parsed.ext}`)
}

async function cutOverLegacyPluginInstallLedger(
  cwd: string,
  scope: PluginInstallScopeName,
  ledgerPath: string,
  raw: unknown
): Promise<PluginInstallLedger> {
  const backupPath = getCutOverPluginInstallLedgerBackupPath(ledgerPath)
  const emptyLedger: PluginInstallLedger = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    installs: {},
    selections: {},
  }

  await ensureDir(path.dirname(ledgerPath))
  if (!(await pathExists(backupPath))) {
    await writeJsonFile(backupPath, raw)
  }
  await savePluginInstallLedger(cwd, scope, emptyLedger)
  console.warn(
    `AgentRig reset the plugin install ledger for the Open Plugins manifest cut. Previously installed plugins must be reinstalled. Archived the previous ledger to ${backupPath}.`
  )
  return emptyLedger
}

export function getPluginInstallLedgerPath(cwd: string, scope: PluginInstallScopeName) {
  const root = scope === 'workspace' ? cwd : getAgentRigHome()
  return path.join(root, '.agentrig', 'plugin-installs.json')
}

export function getPluginInstallRecordId(
  provider: PluginInstallRecord['provider'],
  scope: PluginInstallScopeName,
  pluginName: string
) {
  return `${provider}:${scope}:${pluginName}`
}

export async function loadPluginInstallLedger(
  cwd: string,
  scope: PluginInstallScopeName
): Promise<PluginInstallLedger> {
  const ledgerPath = getPluginInstallLedgerPath(cwd, scope)
  const raw = await readJsonFile<unknown>(ledgerPath)
  if (!raw) {
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      installs: {},
      selections: {},
    }
  }

  const parsed = pluginInstallLedgerSchema.safeParse(raw)
  if (parsed.success) {
    return parsed.data as PluginInstallLedger
  }

  if (
    typeof raw === 'object' &&
    raw != null &&
    'schemaVersion' in raw &&
    (raw as { schemaVersion?: unknown }).schemaVersion !== LEDGER_SCHEMA_VERSION
  ) {
    return cutOverLegacyPluginInstallLedger(cwd, scope, ledgerPath, raw)
  }

  const issue = parsed.error.issues[0]
  throw new Error(`Invalid plugin install ledger at ${ledgerPath}: ${issue?.message ?? 'invalid data'}`)
}

export async function savePluginInstallLedger(
  cwd: string,
  scope: PluginInstallScopeName,
  ledger: PluginInstallLedger
) {
  const ledgerPath = getPluginInstallLedgerPath(cwd, scope)
  await ensureDir(path.dirname(ledgerPath))
  await writeJsonFile(ledgerPath, pluginInstallLedgerSchema.parse(ledger))
}

export async function upsertPluginInstallRecords(
  cwd: string,
  scope: PluginInstallScopeName,
  records: PluginInstallRecord[]
) {
  const ledger = await loadPluginInstallLedger(cwd, scope)
  for (const record of records) {
    ledger.installs[record.id] = record
  }
  await savePluginInstallLedger(cwd, scope, ledger)
}

export async function removePluginInstallRecords(
  cwd: string,
  scope: PluginInstallScopeName,
  ids: string[]
) {
  const ledger = await loadPluginInstallLedger(cwd, scope)
  for (const id of ids) {
    delete ledger.installs[id]
  }
  await savePluginInstallLedger(cwd, scope, ledger)
}

export async function upsertSelectionInstallRecords(
  cwd: string,
  scope: PluginInstallScopeName,
  records: SelectionInstallRecord[]
) {
  const ledger = await loadPluginInstallLedger(cwd, scope)
  for (const record of records) {
    ledger.selections[record.id] = record
  }
  await savePluginInstallLedger(cwd, scope, ledger)
}

export async function removeSelectionInstallRecords(
  cwd: string,
  scope: PluginInstallScopeName,
  ids: string[]
) {
  const ledger = await loadPluginInstallLedger(cwd, scope)
  for (const id of ids) {
    delete ledger.selections[id]
  }
  await savePluginInstallLedger(cwd, scope, ledger)
}

export function listSelectionInstallRecords(
  ledgers: Awaited<ReturnType<typeof loadPluginInstallLedgers>>,
  scopeSelector?: PluginInstallScopeSelectorName
) {
  const records: SelectionInstallRecord[] = []
  if (!scopeSelector || scopeSelector === 'auto' || scopeSelector === 'personal') {
    records.push(...Object.values(ledgers.personal.selections))
  }
  if (!scopeSelector || scopeSelector === 'auto' || scopeSelector === 'workspace') {
    records.push(...Object.values(ledgers.workspace.selections))
  }
  return records
}

export async function loadPluginInstallLedgers(cwd: string) {
  const [personal, workspace] = await Promise.all([
    loadPluginInstallLedger(cwd, 'personal'),
    loadPluginInstallLedger(cwd, 'workspace'),
  ])

  return {
    personal,
    workspace,
  }
}

export function listPluginInstallRecords(
  ledgers: Awaited<ReturnType<typeof loadPluginInstallLedgers>>,
  scopeSelector?: PluginInstallScopeSelectorName
) {
  const records: PluginInstallRecord[] = []
  if (!scopeSelector || scopeSelector === 'auto' || scopeSelector === 'personal') {
    records.push(...Object.values(ledgers.personal.installs))
  }
  if (!scopeSelector || scopeSelector === 'auto' || scopeSelector === 'workspace') {
    records.push(...Object.values(ledgers.workspace.installs))
  }
  return records
}
