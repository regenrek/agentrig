import path from 'node:path'
import { pathExists, readJsonFile, writeJsonFile } from '../fs'
import { getAgentRigHome, getClaudeMarketplaceCacheRoot } from '../paths'
import { claudeMarketplaceManifestSchema } from './schemas'
import {
  loadPluginInstallLedger,
  savePluginInstallLedger,
} from '../plugin-install-ledger'
import type {
  ClaudePluginInstallRecord,
  PluginInstallLedger,
  PluginInstallScopeName,
} from '../types'

/**
 * v0.7.4 introduces a persistent staging directory for Claude marketplaces.
 * Pre-0.7.4 installs registered the marketplace under a `/tmp/agentrig-plugins-XXXX`
 * path that gets cleaned up after install, leaving Claude unable to load the
 * plugin and the ledger pointing at a dead location.
 *
 * This self-heal walks both ledgers, finds Claude install records whose
 * `marketplaceSourcePath` is no longer valid, points them at the canonical
 * persistent path, and patches `~/.claude/plugins/known_marketplaces.json`
 * to match WHEN that persistent path actually contains an exported marketplace.
 *
 * Returns a summary describing what was changed for caller-side logging.
 */
export async function selfHealClaudeInstalls(cwd: string): Promise<{
  patchedLedgerEntries: ClaudeSelfHealPatchedEntry[]
  patchedKnownMarketplaces: string[]
  warnings: string[]
}> {
  const patchedLedgerEntries: ClaudeSelfHealPatchedEntry[] = []
  const warnings: string[] = []

  for (const scope of ['personal', 'workspace'] as const) {
    const ledger = await loadPluginInstallLedger(cwd, scope)
    let mutated = false
    for (const [id, record] of Object.entries(ledger.installs)) {
      if (record.provider !== 'claude') continue
      const claude = record as ClaudePluginInstallRecord
      const sourcePath = claude.metadata.marketplaceSourcePath
      const stale = await isStaleClaudeMarketplaceSource(sourcePath)
      if (!stale) continue

      const persistentPath = getClaudeMarketplaceCacheRoot(claude.metadata.marketplaceName)
      const persistentMarketplace = await validatePersistentClaudeMarketplace(
        persistentPath,
        claude.metadata.marketplaceName
      )
      if (!persistentMarketplace.valid) {
        warnings.push(
          `Claude install ${id} points at stale marketplace path ${sourcePath} but ` +
          `${persistentMarketplace.reason} at ${persistentPath}. ` +
          `Re-run \`agentrig plugin install claude <spec> --force\` to restore it.`
        )
        continue
      }

      const updated: ClaudePluginInstallRecord = {
        ...claude,
        targetPaths: claude.targetPaths.map((p) => (p === sourcePath ? persistentPath : p)),
        metadata: {
          ...claude.metadata,
          marketplaceSourcePath: persistentPath,
        },
      }
      ledger.installs[id] = updated
      mutated = true
      patchedLedgerEntries.push({
        id,
        scope,
        marketplaceName: claude.metadata.marketplaceName,
        previousSource: sourcePath,
        nextSource: persistentPath,
      })
    }
    if (mutated) {
      await savePluginInstallLedger(cwd, scope, ledger as PluginInstallLedger)
    }
  }

  const knownMarketplaces = await selfHealClaudeKnownMarketplaces(patchedLedgerEntries)
  warnings.push(...knownMarketplaces.warnings)

  return { patchedLedgerEntries, patchedKnownMarketplaces: knownMarketplaces.patchedNames, warnings }
}

export type ClaudeSelfHealPatchedEntry = {
  id: string
  scope: PluginInstallScopeName
  marketplaceName: string
  previousSource: string
  nextSource: string
}

async function validatePersistentClaudeMarketplace(
  persistentPath: string,
  expectedMarketplaceName: string
): Promise<{ valid: true } | { valid: false; reason: string }> {
  const manifestPath = path.join(persistentPath, '.claude-plugin', 'marketplace.json')
  if (!(await pathExists(manifestPath))) {
    return { valid: false, reason: 'no valid Claude marketplace manifest exists' }
  }

  try {
    const raw = await readJsonFile<unknown>(manifestPath)
    const parsed = claudeMarketplaceManifestSchema.safeParse(raw)
    if (!parsed.success || parsed.data.name !== expectedMarketplaceName) {
      return { valid: false, reason: 'no valid Claude marketplace manifest exists' }
    }
  } catch {
    return { valid: false, reason: 'no valid Claude marketplace manifest exists' }
  }

  return { valid: true }
}

async function isStaleClaudeMarketplaceSource(sourcePath: string): Promise<boolean> {
  if (!sourcePath) return true
  // The /tmp/agentrig-plugins-XXX shape was the canonical pre-0.7.4 staging
  // path. Treat any of those as stale even if some happen to still exist.
  if (path.basename(sourcePath).startsWith('agentrig-plugins-')) return true
  const tmpRoots = ['/tmp/', '/var/folders/']
  if (tmpRoots.some((root) => sourcePath.startsWith(root))) return true
  return !(await pathExists(sourcePath))
}

async function selfHealClaudeKnownMarketplaces(patches: ClaudeSelfHealPatchedEntry[]) {
  if (patches.length === 0) return { patchedNames: [], warnings: [] }
  const knownPath = path.join(getAgentRigHome(), '.claude', 'plugins', 'known_marketplaces.json')
  const warnings: string[] = []
  let known: Record<string, ClaudeKnownMarketplaceEntry> | null = null
  try {
    known = await readJsonFile<Record<string, ClaudeKnownMarketplaceEntry>>(knownPath)
  } catch (error) {
    warnings.push(
      `Patched Claude install ledger but could not read ${knownPath}: ${
        error instanceof Error ? error.message : String(error)
      }. Re-run install with --force if Claude still points at the old marketplace path.`
    )
    return { patchedNames: [], warnings }
  }
  if (!known) {
    warnings.push(
      `Patched Claude install ledger but ${knownPath} does not exist. ` +
      'Re-run install with --force if Claude still points at the old marketplace path.'
    )
    return { patchedNames: [], warnings }
  }

  const updatedNames: string[] = []
  const patchedIds = new Set<string>()
  for (const patch of patches) {
    for (const [name, entry] of Object.entries(known)) {
      const sourcePath = entry.source?.path
      if (name !== patch.marketplaceName && sourcePath !== patch.previousSource) continue
      known[name] = {
        ...entry,
        source: {
          ...entry.source,
          path: patch.nextSource,
        },
        installLocation: patch.nextSource,
        lastUpdated: new Date().toISOString(),
      }
      updatedNames.push(name)
      patchedIds.add(patch.id)
    }
    if (!patchedIds.has(patch.id)) {
      warnings.push(
        `Patched Claude install ledger for ${patch.id} but could not update ` +
        `${knownPath}: no entry named ${patch.marketplaceName} or pointing at ${patch.previousSource}. ` +
        'Re-run install with --force if Claude still points at the old marketplace path.'
      )
    }
  }
  if (updatedNames.length > 0) {
    await writeJsonFile(knownPath, known)
  }
  return { patchedNames: updatedNames, warnings }
}

type ClaudeKnownMarketplaceEntry = {
  source?: { source?: string; path?: string; repo?: string }
  installLocation?: string
  lastUpdated?: string
}

// Convenience export for tests that want to inject an explicit fs path.
export const __testing__ = {
  isStaleClaudeMarketplaceSource,
}
