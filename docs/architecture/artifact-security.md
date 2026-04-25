# AgentRig Artifact Security And Trust Model

Project: agentrig-mono
PlanDB database: `/Users/kregenrek/projects/agentrig-mono/.plandb.db`
Relevant parent task: `t-ar-catalog-program`
Task: `t-ar-catalog-security`
Updated: 2026-04-25

## Purpose

This contract defines security rules for first-class artifact catalog support:
plugins, skills, MCPs, hooks, and later commands/agents. It covers standalone
artifacts, bundled artifacts extracted from plugins, and selection-based local
installs through AgentRig-managed Selection Bundles.

Security goals:

- preserve the signed registry as the only public installability authority.
- support granular artifact selection without per-artifact lifecycle drift.
- make capability and trust state explicit before install.
- make uninstall safe for user-edited files and JSON configuration.
- keep deterministic scan, extraction, closure, and bundle construction in SDK.

## Trust Authority

Registry trust tiers remain canonical:

```ts
type TrustTier = 'official' | 'reviewed' | 'listed' | 'blocked' | 'yanked'
```

Registry installability remains canonical:

```ts
type InstallabilityState = 'installable' | 'discovery_only' | 'blocked' | 'yanked'
```

Rules:

- `official` and `reviewed` may install only when installability is
  `installable`.
- `listed` is browse-only and must be rejected for install.
- `blocked` and `yanked` must be rejected for new installs.
- directory presence never upgrades trust or installability.
- bundled artifacts inherit the parent plugin registry trust unless they have a
  standalone signed registry entry.
- external repo selections are local provenance only and must never include
  `VerifiedRegistryIdentity`.

## Provenance Classes

Selection Bundles carry one source provenance class:

```ts
type SelectionSourceKind =
  | 'registry-plugin'
  | 'registry-artifact'
  | 'external-repo-scan'
```

`registry-plugin` and `registry-artifact` require registry alias, registry URL,
signed registry document identity, artifact kind/ID, version, lock or snapshot
digest, trust tier, and installability checked before install.

`external-repo-scan` requires canonical repo/source URL, ref, resolved commit
when available, source path, SDK scan digest, and picked selectors.

External repo provenance is not public trust. UI and CLI must label it as
unverified/local even if the source directory resembles a signed artifact.

## Capability Declarations

Every registry artifact and extracted bundled artifact exposes deterministic
capability metadata where available:

- `capability_set`
- `declared_network_domains`
- `declared_secrets`
- `runtime_requirements`
- `dependencies`
- provider targets
- artifact kind
- artifact origin

MCP artifacts must declare configured server names, command or transport shape,
declared network domains, declared secrets/env variables, and runtime
requirements such as node, python, binary command, or docker.

Hooks must declare hook event names, command/prompt type, timeout if applicable,
runtime requirements, declared secrets, and declared network domains.

Skills must declare dependencies when they require files outside the skill root.
Implicit `../shared/*` references are not enough for selection install.

## Selection Closure

A selected artifact is closed when every required file is either:

- inside the artifact root.
- included in the same Selection Bundle.
- declared as a dependency that is also selected or satisfied by full-source
  install.

Closure status:

```ts
type ClosureStatus =
  | 'closed'
  | 'requires-dependencies'
  | 'requires-full-source'
```

SDK owns closure detection. CLI and web consume the result.

Install behavior:

- `closed`: install may continue.
- `requires-dependencies`: CLI/web must show required selectors and require user
  confirmation or explicit `--pick` additions.
- `requires-full-source`: selection install must stop unless user chooses full
  plugin/source install.

AI enrichment cannot change closure status, picked files, dependency decisions,
or source provenance.

## Selection Bundle Ledger

A Selection Bundle is one local lifecycle atom:

```ts
type SelectionBundleSecurityRecord = {
  selectionId: string
  provider: 'claude' | 'codex' | 'cursor'
  scope: 'personal' | 'workspace'
  sourceKind: SelectionSourceKind
  sourceDigest: string
  selectedArtifactSelectors: string[]
  closureDecisions: Array<{
    selector: string
    status: ClosureStatus
    requiredSelectors: string[]
  }>
  installedFileHashes: Array<{ path: string; digest: string }>
  jsonWrites: Array<{
    path: string
    keyPath: string
    writtenValueDigest: string
    previousValueDigest?: string
  }>
}
```

Rules:

- one bundle equals one ledger record and one uninstall target.
- multiple bundles from the same source may coexist.
- record IDs include provider, scope, and `selectionId`.
- uninstall never uses artifact name alone.
- registry bundles require verified registry metadata.
- external repo bundles must not store verified registry metadata.

## JSON Merge Ownership

MCP and hook merges are hash-owned.

Before merge:

- parse JSON with a structured parser.
- normalize the target key path.
- compute `previousValueDigest` when the key exists.
- reject duplicate keys unless `--force` is passed.
- reject malformed JSON.

After merge:

- write only the selected key or object.
- record `writtenValueDigest`.
- record target path and key path.

Uninstall:

- remove the key only when current value digest equals `writtenValueDigest`.
- keep the key when current value differs.
- report kept modified entries.
- never restore stale `previousValueDigest` over user edits.

This avoids MCP refcounting and avoids deleting user-owned config.

## File Ownership

File installs are hash-owned.

Before install:

- normalize target paths.
- reject path traversal and absolute paths.
- reject symlinks in delivery payloads.
- reject writes outside provider-approved roots.
- reject overwrite unless existing file is AgentRig-owned or `--force` is
  explicitly passed.

Uninstall:

- delete only files whose current digest matches the ledger digest.
- keep modified files and report them.
- prune empty directories only under AgentRig-created target roots.

## Web Warning Surfaces

Web browse/detail/install snippets must show:

- artifact kind and origin.
- source plugin/repo.
- registry trust tier and installability.
- external repo provenance when not registry-backed.
- closure status.
- required dependencies or full-source requirement.
- declared network domains, secrets, and runtime requirements.
- MCP/hook JSON merge warning when selection writes config.
- blocked/yanked/discovery-only install refusal.

Warnings are not policy. SDK/CLI/server validation must enforce the same rules.

## Registry Validation

Registry validators must reject:

- invalid artifact kind.
- kind/path mismatch.
- duplicate `(kind, artifactId, version)`.
- lock paths outside version root.
- path traversal.
- symlink payloads.
- blocked delivery archives.
- missing standalone manifest.
- malformed capability declarations.
- trust tier and installability mismatch.

The registry signs installability. Web display and CLI install must consume that
state, not infer it from files.

## Trusted Publisher Path

Future GitHub Actions OIDC publishing may mint short-lived publish tokens.

Constraints:

- trusted publisher config is bound to artifact kind, artifact ID, repository,
  workflow filename, optional environment, and owner.
- minted token is single-artifact, single-version, short-lived, and auditable.
- publish token cannot bypass registry validation or review policy.
- OIDC can prove publisher provenance, not install safety by itself.
- trusted publisher status may improve verification vocabulary, but registry
  installability still gates installs.

## Review Gates

Implementation reviews must verify:

- no fake `VerifiedRegistryIdentity` for external repo selections.
- `blocked`, `yanked`, and `discovery_only` fail closed.
- closure detection is SDK-owned and deterministic.
- JSON merge/uninstall is hash-owned.
- user-modified JSON entries and files are preserved.
- web warnings are backed by enforced CLI/server policy.
- Convex keeps one artifact model.
- AI does not alter digests, picked files, closure, or provenance.
