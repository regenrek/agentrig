import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { ensureDir, readJsonFile, writeJsonFile } from './fs'
import { codexMarketplacePluginSchema } from './plugin-providers/schemas'
import type {
  PluginInstallLedger,
  PluginInstallRecord,
  PluginInstallScopeName,
  PluginInstallScopeSelectorName,
} from './types'

const pluginProviderSchema = z.enum(['claude', 'codex', 'cursor'])
const pluginInstallScopeSchema = z.enum(['personal', 'workspace'])
const pluginInstallScopeSelectorSchema = z.enum(['auto', 'personal', 'workspace'])
const pluginInstallSpecIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('registry'),
    registryUrl: z.string().min(1),
    pluginId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('url'),
    manifestUrl: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('file'),
    manifestPath: z.string().min(1),
  }),
])
const pluginInstalledFileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().min(1),
})
const pluginInstallRecordBaseSchema = z.strictObject({
  id: z.string().min(1),
  provider: pluginProviderSchema,
  requestedScope: pluginInstallScopeSelectorSchema,
  specIdentity: pluginInstallSpecIdentitySchema,
  scope: pluginInstallScopeSchema,
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1),
  pluginName: z.string().min(1),
  sourceLocation: z.string().min(1),
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
])
const pluginInstallLedgerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  installs: z.record(z.string(), pluginInstallRecordSchema),
})

export function getPluginInstallLedgerPath(cwd: string, scope: PluginInstallScopeName) {
  const root = scope === 'workspace' ? cwd : homedir()
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
      schemaVersion: 1,
      installs: {},
    }
  }

  const parsed = pluginInstallLedgerSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid plugin install ledger at ${ledgerPath}: ${issue?.message ?? 'invalid data'}`)
  }

  return parsed.data as PluginInstallLedger
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
