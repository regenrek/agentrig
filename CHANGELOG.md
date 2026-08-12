# Changelog

## Unreleased

## [2.0.0] - 2026-08-12

### BREAKING: Agent Plugins 1.0.0

- Adopted [Agent Plugins v1](https://agent-plugins.org/specification) as the canonical package contract.
- New plugins use root `plugin.json`, portable `skills/*/SKILL.md`, root `mcp.json`, and the official schema URLs.
- AgentRig metadata now lives under `extensions["ai.agentrig"]`; AgentRig-specific files live under `ai.agentrig/`.
- `ai.agentrig` is optional and contains only stable author metadata. Registry listing, provenance, scan, verification, risk, approval, ownership, support, and advisory data stay outside the package.
- Added one SDK inspector with tolerant loading and strict publication policies, Agent Skills validation, per-server MCP isolation, provider-native MCP compilation, and realpath/symlink containment checks.
- `.mcp.json` is no longer accepted as a package source file; portable packages use root `mcp.json`.
- Removed the live `.plugin/plugin.json` and `x-agentrig` authoring paths. Immutable already-published registry snapshots remain the only historical exception.

### Security and correctness

- Publication approval and registry mirroring now operate on the exact freshly inspected package bytes instead of trusting stored scan projections.
- Provider export validates real paths and every nested symlink target before materializing files outside the package boundary.
- CLI bundle validation now inspects the complete portable package, including Agent Skills and MCP configuration.
- Cursor remote MCP servers compile to Cursor's native `http` transport while Codex retains `streamable-http`.
- Submit and inspect caches use new scanner namespaces so pre-2.0 scan results cannot cross the hard-cut boundary.
- Registry validation accepts the historical manifest layout only for the two immutable `0.1.0` snapshots already published under that contract.

> AgentRig packages now use the Agent Plugins v1 package layout as their canonical source format. AgentRig-specific governance and deployment metadata is stored outside the portable package. Legacy AgentRig manifest layouts are no longer accepted.

## [0.8.2] - 2026-05-12

### Fixed
- GitHub Actions trusted publishing now prefers the OIDC publish-token path in CI even when a local AgentRig login session exists, avoiding accidental user-session fallback during release jobs.

### Changed
- Documented hardened trusted-publish workflow requirements: manual `workflow_dispatch`, GitHub-hosted runners, job-scoped `id-token: write`, pinned actions, and no dependency caches in OIDC publish jobs.

## [0.8.1] - 2026-05-11

### Fixed
- Repo scans now surface existing `.plugin/plugin.json` manifests as the canonical plugin identity, including nested plugin roots, so hosted submit flows no longer synthesize `<owner>.<repo>` when an authoritative manifest is present.

## [0.8.0] - 2026-05-11

### BREAKING: Open Plugins 1.0.0 manifest contract

AgentRig now requires Open Plugins 1.0.0 conformant `.plugin/plugin.json` manifests. All plugins authored against the previous AgentRig-proprietary shape must be rewritten by hand. There is no automatic migration.

Spec: https://open-plugins.com/plugin-builders/specification

#### Field mapping

| Old (Root) | New |
|---|---|
| `id` | `name` |
| `name` (display) | `x-agentrig.displayName` |
| `kind` value `"agentrig:plugin"` | `x-agentrig.kind: "plugin"` |
| `configSchema` | `x-agentrig.configSchema` |
| `pluginDependencies` | `x-agentrig.pluginDependencies` |
| `author: "..."` (string) | `author: { "name": "..." }` (object) |

Root also accepts standard Open Plugins metadata fields: `homepage`, `repository`, `logo`, `license`, plus `commands`, `agents`, `skills`, `rules`, `hooks`, `mcpServers`, `lspServers`, `outputStyles` (metadata-only in this release).

#### CLI install ledger reset

The local plugin install ledger schemaVersion bumped. On first run after upgrading, the CLI will back up and reset `~/.agentrig/plugin-installs.json` and workspace `.agentrig/plugin-installs.json`. Previously installed plugins must be reinstalled. Provider-native marketplace state in Claude/Codex/Cursor is not reset and may need manual cleanup.

#### Convex data reset

The hosted marketplace dev and prod databases were wiped as part of this release. Existing artifact listings, submissions, inspect saves, enrichment drafts, publish tokens, and trusted publisher records are gone. Re-submit your plugins via the standard submit flow.

#### Schema URL

`https://agentrig.ai/schema/plugin.v1.json` is now Open Plugins 1.0.0 conformant. The URL itself is unchanged; the body is new.

## [0.7.9] - 2026-05-11

### Fixed
- Fixed non-deterministic install-bundle hash verification by capping remote bundle fetch concurrency and preserving the real failure mode from each file fetch. HTTP failures now report `not_fetched` with status, URL, and response snippet instead of being folded into misleading missing-file output.
- Hash verification now distinguishes `hash_mismatch` from `not_written`, so corrupt bytes, failed downloads, and bundle entries without retrievable bytes surface as separate deterministic errors.
- URL-backed install-bundle files are now fetched directly when no inline bytes are present, matching the public bundle contract.

## [0.7.8] - 2026-05-11

### Fixed
- Codex plugin installs now reject unsupported workspace scope during command preflight before registry resolution or bundle materialization, preserving the clean scope error without network activity.

## [0.7.7] - 2026-05-11

### Fixed
- Hard-cut Codex plugin installs and uninstalls to the single Codex JSON-RPC path; AgentRig no longer writes `~/.agents/plugins/marketplace.json` directly when Codex is missing or too old.
- Codex plugin installs now discover the embedded CLI in `/Applications/Codex.app` and `~/Applications/Codex.app` when `codex` is not on `$PATH`.
- GitHub raw install-bundle rate limits now report an HTTP 429 rate-limit message instead of a misleading missing-file hash verification failure.

### Changed
- Codex plugins now support only `--scope personal`; workspace-scoped Codex installs remain supported for skills through `agentrig skill install`.

## [0.7.6] - 2026-05-10

### Fixed
- Hard-cut Codex personal installs to write plugin payloads only under the canonical cache layout: `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`.
- Made `--no-enable` the canonical Codex install flag for leaving a plugin disabled after install.

### Changed
- Removed the v0.7.5 legacy Codex mirror write to `~/.codex/plugins/<name>/`; users who installed with v0.7.5 may manually remove leftover mirror directories with `rm -rf ~/.codex/plugins/<name>`.
- Removed camelCase CLI flag registration for Codex no-enable installs; `--noEnable` is no longer accepted.

## [0.7.5] - 2026-05-10

### Added
- Codex plugin installs now use `codex app-server --listen stdio://` to install and enable AgentRig plugins automatically, so new installs no longer require toggling the plugin in the Codex TUI.
- Added `agentrig plugin install codex ... --no-enable` to install a Codex plugin while leaving it disabled for manual opt-in under `/plugins`.

### Changed
- Codex installs now stage local marketplaces under the persistent AgentRig cache before handing them to Codex. If Codex is missing or older than `0.113.0`, the CLI falls back to the legacy direct marketplace write and explains how to upgrade for automatic enablement.
- Codex uninstalls now try Codex app-server first and preserve the legacy direct cleanup fallback when automatic uninstall is unavailable.

## [0.7.2] - 2026-05-10

### Fixed
- Mirror promotion now decodes inline base64 install-bundle files (`.plugin/plugin.json` in `generated_plugin` shape) instead of attempting to fetch them from upstream GitHub.
- Hard-cut listing-head `installBundle` denormalization; install/browse/mirror all read through `currentVersionId → artifact_listing_versions` only.
- `currentVersionId` dereferences now validate version-row ownership; corrupt pointers no longer leak the wrong artifact.
- Search and install now agree on the canonical `artifactId` (dotted form). CLI search prints the canonical install token; `agentrig plugin install <hyphenated>` falls back to dot form with a clear deprecation hint.
- Public install-bundle and search responses no longer expose internal Convex IDs (`listingId`, `submissionId`, `ownerUserId`, `parentArtifactListingId`). Public DTO type is `MarketplaceListingPublic`.
- Dev-only migration `20260509_materialize_approved_listing_submissions` now requires both the `assertDevOnly()` env gate AND a confirm-token literal.
- Prod deploy script now refuses to deploy unless `verify-prod-target.mjs` confirms the Convex deployment matches the prod allowlist.

### Changed
- SDK type `MarketplaceListing` is split into `MarketplaceListingPublic` (wire format, no internal IDs) and `MarketplaceListingInternal` (Convex-only). Re-exported `MarketplaceListingPublic` is the new public surface — consumers reading `listingId`/`submissionId`/`ownerUserId` must switch to stable `artifactId` + `kind`.
- HTTP routes now reject malformed slugs (`/`, `\`, `..`, charset violations) with 400 instead of generic 404.
- `agentrig` kind enum is now strictly `plugin | skill | mcp | hook` on the public CLI/HTTP surface; `command`/`agent` remain in SDK schema for future support.
- `release.ts` fails loud if GitHub Release create fails after tag push (prevents stranded tags).

## [0.7.1] - 2026-05-10

### Fixed
- Fixed `agentrig plugin install` against the marketplace by switching the install-bundle wire contract to a slug-stable identifier. The CLI now calls `GET /api/cli/install-bundle?kind=<plugin|skill|mcp|hook>&artifactId=<slug>&origin=<standalone|bundled>?` instead of leaking internal Convex listing IDs, and the SDK helper `resolveInstallBundleFromConvex` accepts `{kind, artifactId, origin?}` rather than an opaque listingId.
- Fixed `Missing .plugin/plugin.json` install errors for `generated_plugin`-shape marketplace listings: the install bundle's `file_list[]` now includes the canonical synthesized plugin manifest with content-addressed sha256, inlined bytes, and the original ref/scan-digest preserved in `x-agentrig.source`.

### Added
- Added `agentrig search <query>` for full-text marketplace search (kind/limit/json flags), backed by the new `/api/cli/search?q=...&limit=...&kind=...?` endpoint.

### Changed
- CLI install-bundle resolution prefers any `inline` payload on a `file_list[]` entry before falling back to the source-derived URL, so server-synthesized files (plugin manifests, etc.) are self-contained and never require a separate fetch.
- `@agentrig/sdk` bumped to `0.1.2`. `InstallBundleFile` adds optional `url` and `inline` fields. The CLI consumes the new shape; downstream SDK consumers do not have to.

## [0.7.0] - 2026-05-09

### Added
- Added canonical marketplace listing and install-bundle SDK contracts so CLI installs can consume Convex-backed plugin and artifact listings without registry-materialization fallbacks.
- Exported `PUBLISH_SHAPE_DEFINITIONS` from `@agentrig/sdk` so submit UIs can render canonical labels, descriptions, and examples without maintaining local copies.
- Added an immutable version-snapshot resolution path for CLI installs (`resolveInstallBundleFromConvex` reads through listing `currentVersionId → artifact_listing_versions.installBundle`), plus content-addressed verification via `verifyInstallBundleHashes` against `file_list[].sha256/size`.

### Changed
- Updated CLI, provider install paths, and registry docs around canonical marketplace browse/install flows for plugins and standalone artifacts.
- CLI install resolution now flows through Convex-backed listing IDs instead of the legacy `resolvePluginFromRegistryRef` path; registry refs without a backing listing are no longer resolvable.

## [0.6.1] - 2026-05-08

### Added
- Added a unified submit-source resolver for `agentrig plugin submit` and `agentrig {skill,mcp,hook} submit` that accepts a local plugin path, `owner/repo@tag` shorthand, or GitHub URL plus `--version`/`--path`, replacing the four-flag `--upstreamRepo`/`--upstreamTag`/`--upstreamCommitSha`/`--pluginPath` form on the public CLI.
- Added `@agentrig/sdk/fs-adapters/tar-tree` plus exported `repo-scan/source-policy` and `repo-scan/version` so consumers can scan tarball-backed sources and apply SDK-owned source-policy and scanner-version metadata.
- Added `AGENTRIG_HOME` override across CLI install paths (global config, plugin install ledger, Codex/Cursor personal scopes, selection installs, external scan cache, provider command runners) so test runs and isolated installs can redirect home-scoped reads and writes.

### Changed
- `agentrig plugin uninstall` now accepts AgentRig-managed external plugin ids and names alongside canonical registry refs so consumers can uninstall external plugins by the id printed at install time.
- Claude marketplace manifests now reference the explicit `<pluginRoot>/<pluginName>` path instead of the bare plugin name so Claude resolves the bundled plugin location reliably.
- Repo source resolution now downloads via the resolved GitHub commit URL, normalizes explicit subdirs, and exposes injectable `fetch`/`downloadTemplate` seams for testing.
- Submission and uploads docs now describe the resolved-source CLI flow (`agentrig plugin submit owner/repo@v1.2.3`, `--version`, `--path`) and the matching skill/MCP/hook submit forms.
- Renamed the SDK `plugin_selected` publish shape to `generated_plugin` with `includedSelectors` plus a new `transformPlan` (requested vs included selectors, skipped non-portable artifacts with reasons, setup notes) so submit clients can preview what materializes into the generated plugin, and aligned the CLI `artifact submit --dry-run` and submission output to print `Submission type: canonical upstream review`.

### Fixed
- Trusted-publishing submissions in GitHub Actions now derive their source from `GITHUB_REPOSITORY@GITHUB_REF` plus `GITHUB_SHA`, going through the same resolver as interactive submits instead of constructing four separate canonical fields.

## [0.6.0] - 2026-04-28

### Added
- Added latest-first marketplace install refs so plugin, selection, and standalone skill installs can use unversioned registry refs while `@<version>` remains available for explicit reproducibility and rollback pins.
- Added standalone skill install and uninstall flows through `agentrig skill install` and `agentrig skill uninstall` without requiring `--pick`.
- Added registry-artifact source and install-ledger support so selected and standalone artifact installs record concrete registry provenance, resolved versions, and snapshot integrity.

### Changed
- Registry and integration docs now describe unversioned latest installs as the default public UX and reserve `@<version>` examples for advanced pinned installs.
- Standalone artifact manifests now accept optional `$schema` metadata across supported manifest kinds.

### Fixed
- Fixed root plugin submissions so `plugin_path: "."` is accepted for plugins whose `.plugin/plugin.json` lives at the upstream repo root.

## [0.5.2] - 2026-04-22

### Fixed
- Replaced citty's `runMain` with a local entrypoint that prints only `error.message` on expected failures (not logged in, invalid spec, missing config) and exits 1, instead of letting citty dump the full `Error` object with a Node stack trace.
- Added regression coverage (`tests/lib/run-cli-main.test.ts`) so stack traces on expected errors can't silently regress again.

## [0.5.1] - 2026-04-22

### Changed
- Hard-cut `plugin init` to require canonical `namespace.plugin` ids and updated the starter template so scaffolded skills use the plugin slug (`skills/<plugin-name>/`) instead of the full namespaced id in directory paths.
- Updated authoring docs, README examples, and the starter template README so the documented local test/export flow matches the actual CLI behavior.

### Fixed
- Fixed `agentrig plugin bundle` local validation by restoring real size and file-count limits in `LOCAL_PLUGIN_POLICY` instead of the accidental all-zero values that made every bundle fail.
- Fixed the stale `schemaVersion: 1` plugin-install ledger crash by archiving the old ledger at the exact on-disk boundary and resetting the canonical v2 ledger shape.
- Fixed top-level CLI error output so expected failures print a clean message instead of a full Node stack trace.
- Fixed the default scaffold guidance from `plugin init` so the printed next steps use the working `plugin bundle` and `plugin export --pluginsDir ./<plugin-id>` flow.

## [0.5.0] - 2026-04-22

### Added
- Added `scripts/check-no-legacy-registry-lane.mjs` guard and wired it into `vp run repo:check` so CI fails on any legacy registry output under derived web trees.
- Added canonical install ref documentation (`<registryAlias>/<namespace.plugin>@<version>`) across the CLI overview, init, plugin, and marketplace pages so public installs have one unambiguous form.
- Added a clear submission, admin approval, registry PR, and merge path to the official plugin publishing docs so authors and operators see the same flow.

### Changed
- Restructured `agentrig/` and `agentrig-web/` READMEs so they are short, practical, and free of architectural marketing language.
- Rewrote the registry README and ADR so they describe the installable snapshot contract and the embedded `signature` object that ships with `registry.json`.
- Retired `apps/docs/content/docs/getting-started/first-pack.mdx` in favor of `first-plugin.mdx` so the route, nav, and file name all agree on the canonical term.
- Tightened registry, plugin, and integration docs so examples point at real registry entries (`agentrig/agentrig.core-committer@0.1.0`) and stop referring to non-existent ones.
- Relabeled the account sidebar entry `Upload plugin` to `Submit plugin` so nav and submission behavior match.

### Removed
- Removed the legacy `scripts/build-registry.ts` path and its test so the web surface cannot emit a parallel v1 registry, `manifests/` tree, or `.plugin/install.json` artifacts.
- Removed stale `pnpm registry:build` references from the contribute and guide docs so documented commands match what the repo actually exposes.

### Fixed
- Fixed the broken CI step that invoked the removed `repo:registry:build` task; CI now runs `vp run repo:check` which chains the legacy-lane guard.
- Fixed the `/submit` UI so it describes pinned GitHub submissions (repo, tag, commit SHA, plugin path) instead of ZIP uploads, matching the implemented flow.

## [0.4.0] - 2026-03-28

### Added
- Added top-level `agentrig plugin install` and `agentrig plugin uninstall` commands as the canonical consumer workflow for Claude, Codex, and Cursor plugins.
- Added canonical install `specIdentity` tracking plus shared normalization for registry, URL, and file specs so uninstall, rig prune, and repair behavior stay deterministic.
- Added plugin plugin graph resolution and materialization coverage for registry-backed plugin installs, including dedicated regression coverage for published registry path rewriting.

### Changed
- Hard-cut the consumer contract to a plugin-first model: removed the old `agentrig add` / `remove` flow and the consumer-facing `plugin plugin install` / `plugin plugin uninstall` commands.
- Simplified configuration and docs around minimal `agentrig init`, flat registries, advanced rigs, and the canonical `agentrig.ai` schema/domain surface.
- Reworked rig application to install provider plugins from resolved plugin specs and prune by canonical install identity instead of legacy plugin-name matching.

### Fixed
- Existing provider plugin directories without a matching ledger entry now require `--force` instead of silently skipping repair.
- Existing provider plugin directories from a conflicting canonical spec identity now fail safely and require `--force` before replacement.
- Registry-backed plugin installs now correctly materialize published plugin file paths from generated registry metadata.

## [0.3.0] - 2026-03-27

### Added
- Added a committed Vite+ application fixture plus subprocess E2E coverage for `agentrig init`, plugin scaffolding, multi-provider export, and Codex/Cursor install-uninstall flows.
- Added a local Vite+ toolchain entrypoint at the repo root via `vite.config.ts` and `vp run`-backed root scripts for validation and fixture maintenance.
- Added a local pre-publish smoke command, `pnpm test:release:local`, that runs coverage, Vite+ E2E, fixture freshness checks, and a packed CLI install smoke test against the installed `agentrig` bin.
- Added packaged CLI smoke coverage across Ubuntu, macOS, and Windows in CI on Node 24.
- Added a non-blocking Node 25 packaged-smoke canary in CI.

### Changed
- Migrated the CLI build from `tsup` to a Vite+/tsdown-backed `vp plugin` configuration.
- Replaced the old plain-Vite playground story with a Vite+ application baseline generated from `vp create vite:application`.
- Release documentation now requires the local pre-publish validation command to pass before shipping a release, and the validation now depends on the local Vite+ toolchain.
- The default CI coverage and Vite+ playground E2E jobs now run on Node 24 LTS instead of Node 20.

## [0.2.2] - 2026-03-27

### Fixed
- Fixed the published CLI entrypoint so `agentrig --help` and other commands no longer crash after global installation with newer Node.js releases.
- Synced the top-level CLI command metadata version with `packages/cli/package.json` so help output reports the shipped version correctly.

## [0.2.1] - 2026-03-27

### Changed
- Refreshed CLI dependencies, including `giget` and `citty`, plus updated Vitest and Node type tooling.
- Updated docs app UI and platform dependencies, including `@base-ui/react`, `lucide-react`, `motion`, `tailwind-merge`, and Iconify packages.
- Aligned the docs Cloudflare toolchain with newer `@cloudflare/vite-plugin` requirements by adding current `wrangler` and `workerd` dev dependencies.

### Fixed
- Removed the deprecated `tar@6.2.1` path that surfaced during `npm install -g agentrig@latest`.
- Restored a passing docs production build after the dependency refresh by bringing the Cloudflare/Vite-side tooling back into a compatible set.

## [0.2.0] - 2026-03-27

### Added
- CLI browser auth commands: `agentrig login`, `agentrig logout`, and `agentrig whoami`.
- Hosted plugin submission flows: `agentrig plugin bundle`, `agentrig plugin submit`, and `agentrig plugin status`.
- Plugin bundle validation, upload policy checks, and submission status handling for the hosted community registry.
- Multi-provider plugin commands for `claude`, `codex`, and `cursor`, including `agentrig plugin export`, `install`, and `uninstall`.
- AgentRig-managed plugin install ledgers for personal and workspace scopes.

### Changed
- Hosted upload docs now document the CLI-first publish flow for reviewed community uploads.
- Provider plugin installs now require explicit broad installs in non-interactive mode, prompt in interactive mode, and print a preflight install summary before writing.
- Cursor now supports explicit workspace installs via `.cursor/plugins/local/`.
- The docs and README now document the published npm CLI flow plus provider-specific integration guides for Claude Code, Codex, and Cursor.

### Fixed
- Claude uninstall no longer removes pre-existing marketplaces that AgentRig did not add.
- Codex marketplace updates now preserve unrelated metadata and foreign entries while matching managed entries more robustly during uninstall.
- Plugin plugin metadata is now validated at the boundary before provider export/install flows use it.
- Codex uninstall now fails safely before deleting managed files when the marketplace top-level structure is invalid.

## [0.1.1] - 2026-01-29
### Added
- Release automation (npm Trusted Publishing via OIDC).
- Security workflows (secret scanning) and Dependabot updates.

### Fixed
- Docs build in CI when local Alchemy config is missing.
- Registry build hardening and release tooling.

## [0.1.0] - 2026-01-24
### Added
- Initial release.
