# Changelog

## [Unreleased]

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
