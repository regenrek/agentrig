# Changelog

## [Unreleased]

### Added
- Added a committed Vite playground fixture plus subprocess E2E coverage for `agentrig init`, pack scaffolding, multi-provider export, and Codex/Cursor install-uninstall flows.
- Added a local pre-publish smoke command, `pnpm test:release:local`, that runs coverage, Vite E2E, fixture freshness checks, and a packed CLI install smoke test.
- Added packaged CLI smoke coverage across Ubuntu, macOS, and Windows in CI on Node 24.

### Changed
- Release documentation now requires the local pre-publish validation command to pass before shipping a release.
- The default CI coverage and Vite playground E2E jobs now run on Node 24 LTS instead of Node 20.

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
- Hosted pack submission flows: `agentrig pack bundle`, `agentrig pack publish`, and `agentrig pack status`.
- Pack bundle validation, upload policy checks, and submission status handling for the hosted community registry.
- Multi-provider plugin commands for `claude`, `codex`, and `cursor`, including `agentrig pack plugin export`, `install`, and `uninstall`.
- AgentRig-managed plugin install ledgers for personal and workspace scopes.

### Changed
- Hosted upload docs now document the CLI-first publish flow for reviewed community uploads.
- `agentrig pack plugin install` now requires explicit broad installs in non-interactive mode, prompts in interactive mode, and prints a preflight install summary before writing.
- Cursor now supports explicit workspace installs via `.cursor/plugins/local/`.
- The docs and README now document the published npm CLI flow plus provider-specific integration guides for Claude Code, Codex, and Cursor.

### Fixed
- Claude uninstall no longer removes pre-existing marketplaces that AgentRig did not add.
- Codex marketplace updates now preserve unrelated metadata and foreign entries while matching managed entries more robustly during uninstall.
- Plugin pack metadata is now validated at the boundary before provider export/install flows use it.
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
