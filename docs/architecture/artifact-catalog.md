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
- partial installs of a bundled child artifact without reinstalling the whole
  plugin.
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
  subSelector: string
}
```

Rules:

- `artifactId` is registry-global within `(kind, id)`, not globally reused by
  path alone.
- bundled child artifacts keep their own `artifactId`, but their installability
  is inherited from the parent signed registry item unless P2 creates a
  standalone signed item for that child.
- `subSelector` is the stable name after `#`, for example
  `agentrig/core@0.1.0#codex-analysis`.
- commands and agents are reserved in the model now, but CLI/web routes can ship
  later.

## SDK Contract

Add SDK modules: `provider/artifact-kinds.ts` and
`provider/extract-artifacts.ts`.

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
agentrig skill install <provider> <alias>/<id>@<version>
agentrig mcp install <provider> <alias>/<id>@<version>
agentrig hook install <provider> <alias>/<id>@<version>

agentrig skill install <provider> <alias>/<plugin-id>@<version>#<skill-name>
agentrig mcp install <provider> <alias>/<plugin-id>@<version>#<mcp-name>
agentrig hook install <provider> <alias>/<plugin-id>@<version>#<hook-name>

agentrig skill submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --artifactPath ...
agentrig mcp submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --artifactPath ...
agentrig hook submit --upstreamRepo ... --upstreamTag ... --upstreamCommitSha ... --artifactPath ...
```

P3 may add the shortcut:

```sh
agentrig install <provider> <ref> [--kind skill|mcp|hook|plugin]
```

Install ref parsing remains canonical. The parser becomes artifact-aware, but
`plugin install` remains a compatibility-preserving alias to kind `plugin`, not
a second implementation.

## Provider Install Contract

Provider adapters get one explicit provider-by-kind table. The table lives near
the existing provider install surface, but SDK owns the materialized artifact
selection that feeds it.

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
- record exact installed or merged paths in the ledger.
- uninstall only removes files or JSON entries with matching recorded digests.

## Install Ledger

The ledger remains the local uninstall authority, but it becomes
artifact-aware.

New fields:

```ts
type ArtifactInstallRecordBase = {
  artifactKind: ArtifactKind
  artifactId: string
  artifactVersion: string
  origin: ArtifactOrigin
  parentPluginId?: string
  parentPluginVersion?: string
  subSelector?: string
}
```

Rules:

- Registry installs still require verified registry metadata.
- External repo installs still must not include verified registry metadata.
- Bundled sub-selector installs record both child identity and parent plugin
  registry identity.
- Record IDs include provider, scope, kind, and child identity, so installing a
  skill from a plugin does not collide with the full plugin install.
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

P1 web adds install snippets for bundled child pages:

```sh
agentrig skill install codex agentrig/agentrig.core-committer@0.1.0#codex-analysis
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

## Phasing

P0: discovery only.

- SDK: artifact kind constants and `extractArtifactsFromPluginLock`.
- Web: `/skills`, `/mcps`, `/hooks`, plugin detail `Contains`,
  `ArtifactCard`, `ArtifactFilesPanel`, and kind badge.
- No CLI, Convex, or registry layout changes.

P1: bundled sub-selector install.

- CLI: `skill|mcp|hook install <provider> <plugin-ref>#<name>`.
- Provider adapters: `installArtifactSubset`.
- Ledger: kind, origin, parent plugin, and sub-selector fields.
- Web: bundled artifact install snippets.
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
- bundled child installs record parent registry provenance.
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
