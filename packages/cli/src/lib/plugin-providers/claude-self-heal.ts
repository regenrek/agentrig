import path from 'node:path'
import { pathExists, readJsonFile, writeJsonFile } from '../fs'
import { getAgentRigHome, getClaudeMarketplaceCacheRoot } from '../paths'
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
      const persistentExists = await pathExists(persistentPath)
      if (!persistentExists) {
        warnings.push(
          `Claude install ${id} points at stale marketplace path ${sourcePath} but ` +
          `no persistent staging exists at ${persistentPath}. ` +
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
        previousSource: sourcePath,
        nextSource: persistentPath,
      })
    }
    if (mutated) {
      await savePluginInstallLedger(cwd, scope, ledger as PluginInstallLedger)
    }
  }

  const patchedKnownMarketplaces = await selfHealClaudeKnownMarketplaces(patchedLedgerEntries)

  return { patchedLedgerEntries, patchedKnownMarketplaces, warnings }
}

export type ClaudeSelfHealPatchedEntry = {
  id: string
  scope: PluginInstallScopeName
  previousSource: string
  nextSource: string
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
  if (patches.length === 0) return []
  const knownPath = path.join(getAgentRigHome(), '.claude', 'plugins', 'known_marketplaces.json')
  const known = await readJsonFile<Record<string, ClaudeKnownMarketplaceEntry>>(knownPath)
  if (!known) return []

  const updatedNames: string[] = []
  for (const patch of patches) {
    for (const [name, entry] of Object.entries(known)) {
      const sourcePath = entry.source?.path
      if (!sourcePath) continue
      if (sourcePath !== patch.previousSource) continue
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
    }
  }
  if (updatedNames.length > 0) {
    await writeJsonFile(knownPath, known)
  }
  return updatedNames
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
