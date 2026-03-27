# Changelog

## [Unreleased]

### Added
- CLI browser auth commands: `agentrig login`, `agentrig logout`, and `agentrig whoami`.
- Hosted pack submission flows: `agentrig pack bundle`, `agentrig pack publish`, and `agentrig pack status`.
- Pack bundle validation, upload policy checks, and submission status handling for the hosted community registry.

### Changed
- Hosted upload docs now document the CLI-first publish flow for reviewed community uploads.

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
