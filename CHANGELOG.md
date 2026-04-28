# Changelog

## [Unreleased]

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
