# How To Release agentrig

This project ships via the Node script at `scripts/release.ts`. The script bumps versions, builds, pushes tags, and creates a GitHub Release with notes from `CHANGELOG.md`. Publishing to npm is a manual maintainer action after local validation.

## Prerequisites
- Node 20+
- pnpm (`corepack enable && corepack prepare pnpm@latest --activate` works too)
- GitHub CLI (`gh auth status` shows logged in)
- npm auth for a maintainer with publish rights on the `agentrig` package (`npm whoami` must return that account)
- Clean `main` branch pushed to origin

## Prepare
- Update `CHANGELOG.md` with a new section (e.g., `## [0.1.4] - YYYY-MM-DD`).
  - **Important**: The section header must match the exact version format: `## [X.Y.Z] - YYYY-MM-DD`
  - Include detailed descriptions of changes (Added/Changed/Fixed sections) so users can easily see what's included in the release
  - The release script extracts this section automatically for the GitHub Release description
  - Keep historical breaking notes in `CHANGELOG.md`; the current release notes must call out the Agent Plugins v1 hard cut. Normally the release script owns the version bump. For a coordinated release whose package already declares the explicit target version, the script validates and tags the current committed release state without creating an empty commit.
- Ensure any user-facing docs (README, templates) are committed.
- Confirm the repo-local Vite+ toolchain is available:
  - `pnpm exec vp --version`
- Run the mandatory local pre-publish validation:
  - `pnpm test:release:local`
  - This runs the CLI coverage suite, the Vite+ consumer-app subprocess E2E suite, the latest Vite+ fixture check, then builds/packs the CLI and smoke-tests the installed `agentrig` bin with `--version` and `--help`.
  - Do not publish if this command fails.
- **Coverage bar**: `packages/cli/vitest.config.ts` owns the enforced CLI coverage baseline. It currently gates on 52% statements, 42% branches, 54% functions, and 54% lines; raise these thresholds with coverage improvements instead of carrying an aspirational value that release tests do not enforce.
- CI coverage after this change is split intentionally:
  - Ubuntu on Node 24 runs the full coverage and Vite+ playground E2E jobs.
  - Ubuntu, macOS, and Windows run the packaged CLI smoke check on Node 24.
  - Ubuntu on Node 25 runs a non-blocking smoke canary.

## Quick Release
- Patch/minor/major bump and release:
  - `pnpm dlx tsx scripts/release.ts patch` (or `minor`/`major`)
- The script will:
  - Bump `packages/cli/package.json#version`
  - Build the CLI through `vp pack`
  - Commit `chore: release vX.Y.Z` when release files changed; when an explicit target version is already committed, tag that current commit instead
  - Tag `vX.Y.Z` and push (refuses non-`main` unless `ALLOW_NON_MAIN=1`; `ALLOW_NON_MAIN=true` is rejected)
  - Create/Update a GitHub Release with notes from `CHANGELOG.md`

## Production Migration Runbook
AgentRig 2.0 is a contract hard cut, not a legacy rematerialization release. Do not run the deleted 20260509/20260510 listing materialization or remirroring migrations. New approvals rebuild listings only from freshly inspected package bytes, while the registry retains a read-only decoder for the two explicitly allowlisted immutable `0.1.0` snapshots.

For production:

1. Run the complete SDK, CLI, web, and registry release gates on the exact commits to be deployed.
2. Deploy Convex and the Cloudflare application through `agentrig-web`'s guarded `pnpm deploy:prod` command under Node 24.
3. Verify the public package install, inspect, search, and registry endpoints against the deployed version.
4. Do not invoke historical one-shot migrations merely because they remain in an older release log or operator transcript.

## Manual npm Publish
- Publish only after `pnpm test:release:local` passes and the GitHub Release is correct.
- Inspect the tarball before publishing:
  - `pnpm --filter ./packages/cli pack`
  - `tar -tf packages/cli/agentrig-*.tgz | grep -E 'package/(templates/|README.md|LICENSE)'`
- Publish from the packed CLI package:
  - `npm publish packages/cli/agentrig-*.tgz --access public --tag latest --ignore-scripts`
- Do not add npm tokens or Trusted Publishing credentials to GitHub Actions.

## Sanity Checks (optional but recommended)
- Build and pack locally:
  - `pnpm --filter ./packages/cli build`
  - `pnpm --filter ./packages/cli pack`
  - `tar -tf packages/cli/agentrig-*.tgz | grep -E 'package/(templates/|README.md|LICENSE)'`
- Run only the packaged CLI smoke test:
  - `pnpm test:release:smoke`
- Verify after publish:
  - npm page renders README banner
  - `templates/` are present in the tarball
  - Git tag `vX.Y.Z` exists and GitHub Release has notes
  - **GitHub Release description**: Visit the release page and confirm the changelog content is displayed (not just "Full Changelog" link). If missing, check that the CHANGELOG.md section header matches `## [X.Y.Z]` exactly.

## Release Notes Tips
- The script extracts notes from `CHANGELOG.md` for the current version.
- **Changelog Format**: The section header must exactly match `## [X.Y.Z] - YYYY-MM-DD` where `X.Y.Z` is the version being released (e.g., `## [0.2.8] - 2025-11-22`).
- The extracted changelog section becomes the GitHub Release description, so include clear, user-friendly descriptions of changes.
- If that section is missing, it falls back to the section named by `GH_NOTES_REF` (default: `0.1`).
  - Example: `GH_NOTES_REF=0.1.3 pnpm dlx tsx scripts/release.ts patch`
- **Verification**: After release, check the GitHub Release page to confirm the changelog description appears correctly. If it's missing, verify the CHANGELOG.md format matches `## [X.Y.Z] - YYYY-MM-DD` exactly.

## Prereleases / Dist-Tags
- To ship a prerelease, publish manually with `--tag next`.

## Rollback / Deprecation
- Prefer deprecation over unpublish:
  - `npm deprecate agentrig@X.Y.Z "Reason…"`
- Only unpublish if necessary and allowed:
  - `npm unpublish agentrig@X.Y.Z --force`
- Create a follow-up patch release that fixes the issue.

## Troubleshooting
- `npm publish` fails:
  - Confirm `npm whoami` returns the maintainer account with publish rights.
  - Confirm the package version has not already been published.
  - Confirm the package is not blocked by npm 2FA or account policy prompts.
- GitHub Release creation fails after the release commit/tag push:
  - Treat the release as incomplete. Create the missing Release with the command printed by `scripts/release.ts`.
- `gh` failures: `gh auth status`; ensure `repo` scope exists.
- Tag push rejected: pull/rebase or fast-forward `main`, then rerun.
