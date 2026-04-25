# AgentRig Artifact Catalog Architecture

Project: agentrig-mono
PlanDB database: `/Users/kregenrek/projects/agentrig-mono/.plandb.db`
Relevant parent task: `t-ar-catalog-program`
Task: `t-ar-catalog-arch`
Updated: 2026-04-25

## Problem

AgentRig currently treats the signed registry, CLI install/submit flow, and web
catalog as plugin-first surfaces. That blocks first-class standalone skills,
MCPs, and hooks, even though plugins already bundle those artifact shapes.

The catalog must support:

- standalone plugins, skills, MCPs, hooks, and later commands/agents.
- bundled child artifacts extracted from a signed plugin lock.
- selection-based installs of one or more child artifacts from a plugin,
  registry item, or arbitrary repo scan without forcing the user to install the
  full source bundle.
- one signed installability and trust boundary owned by the registry.
- one SDK-owned artifact extraction and deterministic scan contract consumed by
  CLI and web.

## Non-Negotiable Boundaries

`@agentrig/sdk` is the canonical owner for:

- `VirtualTree`
- deterministic detectors
- scan digest
- materialization
- provider affinity
- AI enrichment schema, prompt, and validation
- artifact kinds and artifact extraction from locks

`agentrig-public` CLI owns:

- local command grammar and UX.
- local source fetch.
- registry resolution and installability checks through SDK/registry contracts.
- provider install execution.
- local install ledger writes.

`agentrig-web` owns:

- hosted browse, submit, auth, moderation, Convex persistence, and UI.
- server-side registry reads.
- rendering artifacts computed from registry/SDK contracts.

`agentrig-registry` owns:

- public installability.
- trust tier.
- signed registry indexes, histories, locks, reviews, and source records.
- registry validation scripts.

Directory presence is never installability. A skill directory inside a plugin is
browsable only after the parent plugin registry item is accepted, and installable
only when the source registry item is installable. `blocked` and `yanked` always
win.

Selection is first-class, but individual artifacts are not independent local
package-manager nodes in v1. AgentRig installs and uninstalls an
AgentRig-managed **Selection Bundle** that records the exact selected artifacts,
source provenance, closure/dependencies, target paths, and written hashes.

## Current Anchors

Existing code already provides the split that this program must preserve:

- SDK feature detection: `packages/sdk/src/provider/plugin-features.ts`
- CLI plugin commands and provider execution:
  `packages/cli/src/commands/plugin/*`,
  `packages/cli/src/lib/plugin-providers/shared.ts`,
  `packages/cli/src/lib/plugin-install-spec.ts`,
  `packages/cli/src/lib/plugin-install-ledger.ts`,
  `packages/cli/src/lib/plugin-bundle.ts`, and
  `packages/cli/src/lib/plugin-validation.ts`
- web registry/schema surfaces: `agentrig-web/convex/schema.ts`,
  `agentrig-web/src/lib/registry.ts`,
  `agentrig-web/src/lib/registry-source.ts`, and
  `agentrig-web/src/routes/plugins/*`
- registry contract: `agentrig-registry/registry.json`,
  `agentrig-registry/plugins/agentrig/core-committer/versions/0.1.0/AGENTRIG_LOCK.json`,
  and `agentrig-registry/scripts/validate-registry.mjs`

## Artifact Model

Artifact kind is a first-class axis:

```ts
type ArtifactKind = 'plugin' | 'skill' | 'mcp' | 'hook' | 'command' | 'agent'
```

Artifact origin is a first-class axis:

```ts
type ArtifactOrigin = 'standalone' | 'bundled'
```

Canonical artifact identity:

```ts
type ArtifactIdentity = {
  kind: ArtifactKind
  artifactId: string
  version: string
}
```

Bundled artifact identity:

```ts
type BundledArtifactIdentity = ArtifactIdentity & {
  origin: 'bundled'
  parentArtifactId: string
  parentArtifactKind: 'plugin'
  parentVersion: string
  selector: string
}
```

Rules:

- `artifactId` is registry-global within `(kind, id)`, not globally reused by
  path alone.
- bundled child artifacts keep browse identity, but their installability is
  inherited from the parent signed registry item unless P2 creates a standalone
  signed item for that child.
- `selector` is the stable artifact-local name used in `--pick`, for example
  `skill:codex-analysis`.
- commands and agents are reserved in the model now, but CLI/web routes can ship
  later.

## Selection Bundle Model

The install/uninstall lifecycle atom is a Selection Bundle:

```ts
type SelectionBundle = {
  selectionId: string
  provider: 'claude' | 'codex' | 'cursor'
  scope: 'personal' | 'workspace'
  source: {
    kind: 'registry-artifact' | 'registry-plugin' | 'external-repo-scan'
    registryRef?: string
    repo?: string
    ref?: string
    commit?: string
    sourcePath?: string
    scanDigest: string
  }
  selectedArtifacts: Array<{
    kind: ArtifactKind
    name: string
    selector: string
    files: Array<{ path: string; digest: string }>
    dependencies: Array<{ kind: ArtifactKind; selector: string }>
    closureStatus: 'closed' | 'requires-dependencies' | 'requires-full-source'
  }>
  targetPaths: string[]
  installedFileHashes: Array<{ path: string; digest: string }>
  jsonWrites: Array<{
    path: string
    keyPath: string
    writtenValueDigest: string
    previousValueDigest?: string
  }>
}
```

Selection Bundle rules:

- A user can select one skill, many skills, a skill plus an MCP, or any future
  supported artifact mix from the same scanned source.
- The bundle is one ledger record and one uninstall target. This avoids a
  dependency-package-manager explosion while still solving the real product
  problem: installing 2 desired skills from a 100-skill repo.
- A selected artifact is installable only if it is **closed**: all required files
  live under the artifact root or are explicitly declared as dependencies in the
  source/lock metadata.
- If a skill references implicit shared files such as `../shared/*`, the CLI/web
  must require one of: add declared dependencies to the selection, install the
  full source plugin, or refuse the selection install.
- MCP and hook JSON merges are hash-owned. Uninstall removes only keys whose
  current value still matches the AgentRig-written digest. Modified user entries
  are kept and reported.

## SDK Contract

Add SDK modules: `provider/artifact-kinds.ts`,
`provider/extract-artifacts.ts`, and `provider/selection-bundle.ts`.

The SDK exports:

```ts
export const ARTIFACT_KINDS = ['plugin', 'skill', 'mcp', 'hook', 'command', 'agent'] as const

export type ExtractedArtifact = {
  kind: ArtifactKind
  origin: 'bundled'
  name: string
  artifactId: string
  parentArtifactId: string
  parentVersion: string
  selector: string
  paths: string[]
  fileDigests: Array<{ path: string; digest: string }>
  capabilitySet: string[]
  declaredNetworkDomains: string[]
  declaredSecrets: string[]
  runtimeRequirements: string[]
}

export function extractArtifactsFromPluginLock(lock: RegistryLock): ExtractedArtifact[]
export function detectArtifactClosure(tree: VirtualTree, artifact: ExtractedArtifact): ArtifactClosure
export function buildSelectionBundle(input: SelectionBundleInput): SelectionBundle
```

Extraction rules:

- Input is the registry lock plus enough parent identity to build child IDs.
- Use normalized POSIX paths and existing `VirtualTree` normalization rules.
- Skill roots are `skills/<name>/` with required `SKILL.md`.
- MCP roots are `.mcp.json`, `mcp.json`, or future `mcps/<name>/` manifests.
- Hook roots are `hooks/` plus `hooks/hooks.json`.
- Command roots are `commands/<name>.md`.
- Agent roots are `agents/<name>.md`.
- Extracted child `paths` are exact file paths from the signed lock. AI cannot
  add, remove, or reorder them.
- Child file digest is copied from the lock. Child digest is computed from the
  selected file digest set and parent identity, not from web/CLI rescans.
- Empty or malformed child candidates are omitted with deterministic warnings.
- Closure detection is deterministic and does not read provider state.
- Selection Bundle construction is deterministic for the same source digest and
  selected artifact set.

The SDK must not know Convex tables or CLI output formatting. It owns pure
contracts and deterministic transforms.

## CLI Grammar

Keep the existing plugin grammar working:

```sh
agentrig plugin install <provider> <alias>/<id>@<version>
agentrig plugin uninstall <provider> <alias>/<id>@<version>
agentrig plugin submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --pluginPath ...
```

Add subcommand-first artifact grammar:

```sh
agentrig skill install <provider> <source> --pick <skill-name> [--pick <skill-name>...]
agentrig mcp install <provider> <source> --pick <mcp-name> [--pick <mcp-name>...]
agentrig hook install <provider> <source> --pick <hook-name> [--pick <hook-name>...]

agentrig install <provider> <source> \
  --pick skill:best-practice-coding \
  --pick skill:computer-use-skill

agentrig skill submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --artifactPath ...
agentrig mcp submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --artifactPath ...
agentrig hook submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --artifactPath ...
```

`<source>` may be a signed registry plugin, a standalone signed artifact, or an
external repo/URL accepted by the existing inspect/use source resolver. The CLI
materializes the selected artifacts into one Selection Bundle and writes one
ledger record for that bundle.

P3 may add shorter interactive or shorthand commands, but they must still
materialize to Selection Bundles:

```sh
agentrig skill install <provider> <source> --interactive
agentrig mcp install <provider> <source> --interactive
```

Install source parsing remains canonical. The parser becomes selection-aware,
but `plugin install` remains a compatibility-preserving full plugin path, not a
second implementation.

## Provider Install Contract

Provider adapters get one explicit provider-by-kind table. The table lives near
the existing provider install surface, but SDK owns the materialized Selection
Bundle that feeds it.

| kind | claude | codex | cursor |
| --- | --- | --- | --- |
| plugin | current plugin install | current plugin install | current plugin install |
| skill | `skills/<name>/` | `skills/<name>/` | `.cursor/skills/<name>/` |
| mcp | merge `.mcp.json` | merge `.mcp.json` | merge `mcp.json` |
| hook | `hooks/` + merge `hooks.json` | `hooks/` | `.cursor/hooks/` |
| command | `commands/<name>.md` | skip + warn | `.cursor/commands/<name>.md` |
| agent | `agents/<name>.md` | skip + warn | `.cursor/agents/<name>.md` |

Provider-specific merge behavior must be deterministic:

- validate JSON before merge.
- reject duplicate keys unless `--force` is passed.
- record exact installed files, merged JSON keys, and written value digests in
  the selection ledger.
- uninstall only removes files or JSON entries with matching recorded digests.
- if a user modifies an AgentRig-written JSON key, uninstall keeps it and reports
  `kept modified`.

## Install Ledger

The ledger remains the local uninstall authority, but it becomes
selection-aware.

New fields:

```ts
type SelectionInstallRecord = {
  selectionId: string
  provider: PluginProviderId
  scope: PluginInstallScope
  source: SelectionBundle['source']
  selectedArtifacts: SelectionBundle['selectedArtifacts']
  targetPaths: string[]
  installedFileHashes: SelectionBundle['installedFileHashes']
  jsonWrites: SelectionBundle['jsonWrites']
}
```

Rules:

- Registry installs still require verified registry metadata.
- External repo installs still must not include verified registry metadata.
- Selection installs from signed plugins record parent registry identity plus
  selected artifact selectors.
- Selection installs from external repo scans record repo/ref/commit/source path
  and scan digest, not registry trust.
- Record IDs include provider, scope, and `selectionId`, so multiple selections
  from the same 100-skill source can coexist without pretending each artifact is
  a global package dependency.
- Ledger migration is hard-cut by schema version. Do not keep dual readers
  beyond the single explicit migration boundary.

## Registry Layout

P2 extends the signed registry layout additively:

```text
plugins/<scope>/<id>/versions/<version>/
skills/<scope>/<id>/versions/<version>/
mcps/<scope>/<id>/versions/<version>/
hooks/<scope>/<id>/versions/<version>/
```

Each version directory keeps the existing signed artifact bundle shape:

```text
AGENTRIG_LOCK.json
AGENTRIG_REVIEW.json
AGENTRIG_SOURCE.json
LICENSE
README.md
.<kind>/<kind>.json
```

Manifest roots:

- plugin: `.plugin/plugin.json`
- skill: `.skill/skill.json`
- mcp: `.mcp/mcp.json`
- hook: `.hook/hook.json`

`registry.json` items add `kind`, defaulting existing rows to `plugin` during
the migration. Registry history documents add the same field. Version records
keep `manifest`, `source`, `lock`, `review`, `trust_tier`, `installability`,
`snapshot_digest`, and `published_at`.

The lock adds artifact-level fields only where deterministic:

```ts
type RegistryLock = {
  artifact_kind: ArtifactKind
  artifact_id: string
  version: string
  file_digests: Array<{ path: string; digest: string }>
  dependencies: Array<{ kind: ArtifactKind; artifact: string; version: string }>
  snapshot_digest: string
}
```

Existing plugin locks remain readable in P0/P1. P2 writes the new standalone
shape and accepts old plugin locks only at the migration boundary.

## Convex Model

P2 renames plugin tables to artifact tables:

- `plugin_listings` -> `artifact_listings`
- `plugin_submissions` -> `artifact_submissions`

Do not create separate `skills` and `packages` tables. ClawHub's split model is
rejected because it creates parallel persistence and search drift.

`artifact_listings` required fields:

```ts
{
  kind: ArtifactKind
  origin: ArtifactOrigin
  artifactId: string
  name: string
  description: string
  version: string
  parentArtifactListingId?: Id<'artifact_listings'>
  parentArtifactId?: string
  capabilityTags?: string[]
  verificationTier?: string
  directoryState?: DirectoryState
  registryInstallability?: InstallabilityState
  registryTrustTier?: TrustTier
}
```

Required indexes:

- `by_kind`
- `by_kind_directoryState`
- `by_parent`
- `by_origin`
- existing identity, owner, moderation, like, update, and registry indexes
  translated to artifact naming.

Migration rule:

- every existing plugin row becomes `kind: 'plugin'` and `origin:
  'standalone'`.
- existing submission rows become `kind: 'plugin'`.
- bundled rows can be materialized by web from registry locks in P0/P1, then
  optionally persisted after P2 if needed for search, moderation, and stats.

## Web Contract

P0 web is read-only and registry-derived:

- `/plugins` continues to show plugin registry items.
- `/skills`, `/mcps`, and `/hooks` compute bundled child artifacts from plugin
  locks through the SDK extractor.
- plugin detail gets a `Contains` section linking to child artifact detail
  pages.
- `PluginCard`, `PluginFilesPanel`, and install card components become
  artifact-agnostic components with default `kind: 'plugin'`.

P1 web adds install snippets and selection UI for bundled child pages:

```sh
agentrig install codex agentrig/agentrig.core-committer@0.1.0 --pick skill:codex-analysis
```

Plugin/repo scan pages must support multi-select:

```sh
agentrig install codex <source> \
  --pick skill:best-practice-coding \
  --pick skill:computer-use-skill
```

P2 web adds standalone submission:

- kind picker in `/submit`.
- per-kind manifest/path validation.
- shared `PasteRepoScanCard`.
- verification badges backed by registry/Convex trust state.

Web must not reimplement artifact extraction. It imports SDK contracts or uses a
generated registry-derived artifact payload produced by SDK code.

## Security And Trust

Trust rules:

- registry installability gates every signed install.
- direct repo installs remain external-repo provenance and never acquire
  registry trust.
- bundled child installability inherits parent plugin signed status unless the
  child has its own standalone signed registry entry.
- selection installs inherit the trust status of their source. A selection from
  an external repo scan is external-repo provenance only; it is never displayed
  or logged as registry verified.
- `blocked` and `yanked` are terminal for normal installs.
- AI enrichment can suggest descriptions, keywords, or summaries only. It cannot
  change deterministic scan digest, picked files, artifact paths, or lock file
  digest sets.

Capability fields:

- `capability_set`
- `declared_network_domains`
- `declared_secrets`
- `runtime_requirements`
- `capabilityTags`
- `verificationTier`

Registry validation must reject:

- path traversal.
- symlinks in delivery payloads.
- duplicate artifact IDs for the same kind.
- invalid standalone manifests.
- artifact lock paths outside the version directory.
- blocked delivery archives in source payload.
- kind/path mismatches, for example a skill item pointing at `.plugin/plugin.json`.

Selection validation must reject or require explicit user action for:

- selected artifacts whose file closure is incomplete.
- undeclared shared dependencies.
- duplicate MCP JSON keys unless `--force` is passed.
- attempts to remove or overwrite user-modified JSON entries during uninstall.

## Phasing

P0: discovery only.

- SDK: artifact kind constants and `extractArtifactsFromPluginLock`.
- Web: `/skills`, `/mcps`, `/hooks`, plugin detail `Contains`,
  `ArtifactCard`, `ArtifactFilesPanel`, and kind badge.
- No CLI, Convex, or registry layout changes.

P1: selection-based bundled/repo artifact install.

- SDK: closure detection and Selection Bundle construction.
- CLI: `install <provider> <source> --pick kind:name` and kind-specific helper
  commands for selecting skills/MCPs/hooks.
- Provider adapters: install from a materialized Selection Bundle.
- Ledger: one selection record with source provenance, selected artifacts,
  target paths, file hashes, and JSON write ownership.
- Web: bundled/repo artifact multi-select and install snippets.
- Registry still plugin-only for standalone signed items.

P2: standalone artifact submission.

- Registry: top-level `skills/`, `mcps/`, `hooks/`, `kind` fields, standalone
  mini-manifest schemas, and validator support.
- SDK: standalone manifest schemas and `detectStandaloneKind`.
- CLI: `skill|mcp|hook submit`.
- Convex: artifact table migration and indexes.
- Web: kind-aware submit UX.

P3: command unification and trusted publisher.

- CLI: top-level `agentrig install`.
- CLI: deprecate `plugin install` as wording only, not behavior.
- Convex: GitHub Actions OIDC trusted publisher tables.
- CLI: CI publish using short-lived publish tokens.

## Rejected Alternatives

- Copy ClawHub's `skills` plus `packages` persistence split. Rejected: one
  artifact table is the AgentRig source of truth.
- Treat every selected artifact as an independent local package dependency.
  Rejected: causes ledger explosion, MCP refcounting, and hard update semantics.
  Selection Bundles are the lifecycle atom.
- Encode kind inside refs like `skill:<alias>/<id>@<version>`. Rejected:
  subcommand-first grammar is clearer and matches existing CLI shape.
- Let web scan plugin locks with local path rules. Rejected: SDK owns artifact
  extraction.
- Let directory presence override registry status. Rejected: weakens signed
  installability.
- Let AI enrichers pick child files. Rejected: deterministic lock extraction is
  the only file-selection path.
- Keep duplicate provider copy tables in each provider file. Rejected: one
  provider-by-kind policy table must drive all adapters.

## Review Gates

Every implementation phase must prove:

- no duplicate scanner/digest/materializer/artifact extractor in CLI or web.
- registry installability is checked before all signed installs.
- direct repo installs do not fabricate `VerifiedRegistryIdentity`.
- selection installs record source provenance, selected artifacts, closure
  decisions, and written hashes.
- provider merge installs are uninstall-safe.
- Convex has one artifact model.
- old `agentrig plugin install/uninstall/submit` commands still work.

## Final Verification Targets

Program final verification should run the repo-local gates:

```bash
cd /Users/kregenrek/projects/agentrig-mono/agentrig-public
TMPDIR=/tmp pnpm check
TMPDIR=/tmp pnpm --filter @agentrig/sdk build
TMPDIR=/tmp pnpm --filter agentrig build
git diff --check
```

Also run the web typecheck, web vitest `--run`, Convex codegen, web build,
registry validator, and `git diff --check` in each changed repo. For this
architecture task, validation is limited to markdown placement, PlanDB context,
and clean git diff shape because no runtime code changes.
