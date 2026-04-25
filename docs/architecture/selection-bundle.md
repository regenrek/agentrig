# AgentRig Selection Bundle Contract

Project: agentrig-mono
PlanDB database: `/Users/kregenrek/projects/agentrig-mono/.plandb.db`
Relevant parent task: `t-ar-catalog-program`
Task: `t-ar-catalog-selection`
Updated: 2026-04-25

## Purpose

A Selection Bundle is the local install/uninstall lifecycle atom for granular
artifact installs. Artifacts stay first-class for discovery and selection, but
AgentRig does not create an independent local package-manager node for every
skill, MCP, hook, command, or agent.

Core user case:

```bash
agentrig install codex <source> \
  --pick skill:best-practice-coding \
  --pick skill:computer-use-skill
```

The CLI installs exactly those selected artifacts when closure is safe, records
one bundle ledger entry, and later uninstalls only the files and JSON values that
the bundle wrote.

## Ownership

SDK owns:

- artifact kind constants.
- artifact extraction from registry locks and repo scans.
- selector normalization.
- closure detection.
- dependency decisions.
- deterministic `selectionId` construction.
- Selection Bundle construction.
- provider materialization metadata.

CLI owns:

- command UX.
- source resolution.
- registry installability checks before signed installs.
- provider execution.
- local ledger persistence.
- uninstall execution.

Web owns:

- artifact selection UI.
- closure/dependency warning display.
- install command generation.
- browse/detail presentation.

Web and CLI must consume SDK bundle construction output. Neither may duplicate
scanner, extraction, closure, or digest logic.

## Canonical Types

```ts
type ArtifactKind = 'plugin' | 'skill' | 'mcp' | 'hook' | 'command' | 'agent'
type ProviderId = 'claude' | 'codex' | 'cursor'
type InstallScope = 'personal' | 'workspace'

type SelectionSource =
  | {
      kind: 'registry-plugin'
      registryAlias: string
      registryUrl: string
      registryRef: string
      artifactId: string
      version: string
      snapshotDigest: string
    }
  | {
      kind: 'registry-artifact'
      registryAlias: string
      registryUrl: string
      registryRef: string
      artifactKind: ArtifactKind
      artifactId: string
      version: string
      snapshotDigest: string
    }
  | {
      kind: 'external-repo-scan'
      sourceLabel: string
      repoUrl?: string
      owner?: string
      repo?: string
      ref?: string
      commitSha?: string
      subdir?: string
      scanDigest: string
    }

type ClosureStatus =
  | 'closed'
  | 'requires-dependencies'
  | 'requires-full-source'

type SelectedArtifact = {
  kind: ArtifactKind
  name: string
  selector: string
  sourcePath: string
  files: Array<{ path: string; digest: string; bytes?: number }>
  dependencies: Array<{ kind: ArtifactKind; selector: string }>
  closureStatus: ClosureStatus
  closureReason?: string
}

type JsonWrite = {
  path: string
  keyPath: string
  writtenValueDigest: string
  previousValueDigest?: string
}

type SelectionBundle = {
  schemaVersion: 1
  selectionId: string
  provider: ProviderId
  scope: InstallScope
  source: SelectionSource
  selectedArtifacts: SelectedArtifact[]
  targetPaths: string[]
  installedFileHashes: Array<{ path: string; digest: string }>
  jsonWrites: JsonWrite[]
  createdAt?: string
}
```

## Selection ID

`selectionId` is deterministic before install:

```text
sha256(provider, scope, source.kind, source identity, source digest, sorted selectors)
```

Rules:

- selector order does not change the ID.
- provider and scope are part of the ID because targets differ.
- source digest is mandatory.
- registry sources use snapshot/lock digest.
- external repo sources use SDK scan digest.
- two different selections from the same source may coexist.
- the full plugin install path keeps existing plugin ledger identity and is not
  silently rewritten into a selection bundle unless a `--pick` path is used.

## Selector Grammar

Canonical selector:

```text
<kind>:<name>
```

Examples:

```text
skill:best-practice-coding
mcp:github
hook:pre-submit
```

Kind-specific helper commands accept bare names and normalize them:

```bash
agentrig skill install codex <source> --pick best-practice-coding
```

Normalizes to:

```text
skill:best-practice-coding
```

Validation:

- selector kind must be a known artifact kind.
- selector name must be non-empty and stable after trim.
- duplicate selectors collapse before bundle construction.
- unknown selectors fail with available selectors.
- ambiguous bare names are rejected outside kind-specific helper commands.

## Closure Rules

SDK checks closure for each selected artifact.

An artifact is `closed` when every required path is inside the artifact root or
inside another explicitly selected dependency.

An artifact is `requires-dependencies` when SDK can name missing selectors that
would close the selection.

An artifact is `requires-full-source` when SDK detects an implicit shared-file
dependency that cannot be represented safely as selectors.

Install policy:

- `closed`: install may proceed.
- `requires-dependencies`: install stops unless the missing selectors are added
  or the user explicitly chooses full source install.
- `requires-full-source`: partial selection install stops.

Examples that require closure rejection or dependency prompts:

- `skills/foo/SKILL.md` references `../shared/rules.md`.
- `skills/foo/scripts/run.sh` imports `../../scripts/common.sh`.
- MCP config invokes a command file outside the selected MCP root.
- hook JSON points to a script outside the selected hook root.

## Provider Materialization

SDK outputs provider materialization metadata. Provider adapters execute it.

| kind | claude | codex | cursor |
| --- | --- | --- | --- |
| skill | `skills/<name>/` | `skills/<name>/` | `.cursor/skills/<name>/` |
| mcp | merge `.mcp.json` | merge `.mcp.json` | merge `mcp.json` |
| hook | `hooks/` + merge `hooks.json` | `hooks/` | `.cursor/hooks/` |
| command | `commands/<name>.md` | skip + warn | `.cursor/commands/<name>.md` |
| agent | `agents/<name>.md` | skip + warn | `.cursor/agents/<name>.md` |

Materialization metadata must include:

- file copies with source path, target path, and digest.
- JSON writes with target path, key path, and written value digest.
- skipped artifacts with reason.
- warnings for unsupported provider/kind combinations.

Provider adapters must not re-select files or recompute closure.

## Conflict Policy

File conflicts:

- if target does not exist, write and record digest.
- if target exists and digest matches existing AgentRig record, replace only with
  explicit update flow.
- if target exists and is user-owned, reject unless `--force`.
- `--force` records overwrite provenance and previous digest when available.

JSON conflicts:

- malformed target JSON fails.
- existing key fails unless existing digest matches same bundle ownership or
  `--force` is passed.
- `--force` records `previousValueDigest`.
- uninstall never restores previous value over user edits.

Provider unsupported cases:

- unsupported artifact is skipped with warning.
- if every selected artifact is unsupported for provider, install fails.

## Ledger Schema

The CLI ledger gets a new selection record shape. It can live beside plugin
records during the explicit schema migration, but uninstall lookup must use the
selection record for selection installs.

```ts
type SelectionInstallRecord = {
  id: string
  recordKind: 'selection'
  selection: SelectionBundle
  registry?: VerifiedRegistryIdentity
  requestedScope: 'auto' | InstallScope
  installedAt: string
  updatedAt?: string
}
```

Rules:

- `id` includes provider, scope, and `selectionId`.
- registry-backed selections require `registry`.
- external repo selections forbid `registry`.
- ledger records store exact target files and JSON writes.
- uninstall does not resolve the source again.
- update is future work and must compare old bundle source digest to the new
  source digest before changing targets.

## Uninstall

Uninstall takes a selection ledger record.

Files:

- delete only when current digest equals `installedFileHashes.digest`.
- keep and report modified files.
- prune empty directories only below AgentRig-created target roots.

JSON:

- read current target JSON.
- remove key only when current value digest equals `writtenValueDigest`.
- keep and report modified values.
- do not restore `previousValueDigest` automatically.

The uninstall result must report:

- removed files.
- kept modified files.
- removed JSON keys.
- kept modified JSON keys.
- missing paths.
- skipped unsupported provider entries.

## CLI Contract

Canonical selection install:

```bash
agentrig install <provider> <source> --pick <kind:name> [--pick <kind:name>...]
```

Helpers:

```bash
agentrig skill install <provider> <source> --pick <name> [--pick <name>...]
agentrig mcp install <provider> <source> --pick <name> [--pick <name>...]
agentrig hook install <provider> <source> --pick <name> [--pick <name>...]
```

Required output before write:

- source provenance.
- selected selectors.
- closure status.
- provider targets.
- JSON writes.
- skipped unsupported artifacts.
- trust/installability for registry sources.

Existing commands remain:

```bash
agentrig plugin install <provider> <registry-ref>
agentrig plugin uninstall <provider> <registry-ref>
agentrig plugin submit ...
```

## Web Contract

Web artifact pages and plugin/repo pages must support:

- listing contained artifacts.
- selecting multiple artifacts from one source.
- showing closure status and dependency prompts.
- showing trust/installability for registry sources.
- showing external repo provenance for repo scans.
- generating the exact `agentrig install ... --pick ...` command.
- linking each selected artifact to its detail page.

Web must call SDK extraction/closure/bundle APIs or consume payloads produced by
SDK code. It must not duplicate selection logic.

## Implementation Gates

SDK gates:

- deterministic selectors and `selectionId`.
- closure fixtures for closed, requires-dependencies, requires-full-source.
- lock extraction and repo scan extraction produce the same selector grammar.

CLI gates:

- registry-backed selection refuses blocked/yanked/listed.
- external repo selection writes no verified registry identity.
- uninstall preserves modified files and JSON values.
- duplicate MCP key behavior is deterministic.
- existing plugin install/uninstall still works.

Web gates:

- `/skills`, `/mcps`, `/hooks` are first-class browse routes.
- plugin detail exposes contained artifacts.
- multi-select command output uses canonical selectors.
- warnings match SDK closure and capability output.
