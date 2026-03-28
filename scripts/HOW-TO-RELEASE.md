# How To Release agentrig

This project ships via the Node script at `scripts/release.ts`. The script bumps versions, builds, pushes tags, and creates a GitHub Release with notes from `CHANGELOG.md`. Publishing to npm happens automatically via GitHub Actions using npm Trusted Publishing (OIDC).

## Prerequisites
- Node 20+
- pnpm (`corepack enable && corepack prepare pnpm@latest --activate` works too)
- GitHub CLI (`gh auth status` shows logged in)
- npm publish is handled by GitHub Actions (Trusted Publishing); no local `npm login` required
- Clean `main` branch pushed to origin

## Prepare
- Update `CHANGELOG.md` with a new section (e.g., `## [0.1.4] - YYYY-MM-DD`).
  - **Important**: The section header must match the exact version format: `## [X.Y.Z] - YYYY-MM-DD`
  - Include detailed descriptions of changes (Added/Changed/Fixed sections) so users can easily see what's included in the release
  - The release script extracts this section automatically for the GitHub Release description
- Ensure any user-facing docs (README, templates) are committed.
- Confirm the repo-local Vite+ toolchain is available:
  - `pnpm exec vp --version`
- Run the mandatory local pre-publish validation:
  - `pnpm test:release:local`
  - This runs the CLI coverage suite, the Vite+ consumer-app subprocess E2E suite, the latest Vite+ fixture check, then builds/packs the CLI and smoke-tests the installed `agentrig` bin with `--version` and `--help`.
  - Do not publish if this command fails.
- **Release bar**: keep overall coverage **> 80%** (raise it if you touch core installer/config paths)
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
  - Commit `chore: release vX.Y.Z`, tag `vX.Y.Z`, push (refuses non-`main` unless `ALLOW_NON_MAIN=1`)
  - Create/Update a GitHub Release with notes from `CHANGELOG.md`
  - Trigger the GitHub Actions publish workflow (OIDC) on release publish

## npm Trusted Publishing (automatic)
- Configure this once in npm:
  - Go to the package settings → **Access** → **Trusted Publishers**
  - Add GitHub Actions as a trusted publisher for this repo
  - Workflow filename: `npm-release.yml` (just the filename, not the full path)
  - Environment: leave blank unless you use GitHub Environments
- GitHub Actions will mint short-lived OIDC credentials at publish time; no stored tokens.
- The workflow pins npm CLI `11.5.1` to satisfy Trusted Publishing requirements.
- Note: This workflow runs on **GitHub Release published** (draft releases do not publish to npm).

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
- **Changelog Format**: The section header must exactly match `## [X.Y.Z]` where `X.Y.Z` is the version being released (e.g., `## [0.2.8] - 2025-11-22`).
- The extracted changelog section becomes the GitHub Release description, so include clear, user-friendly descriptions of changes.
- If that section is missing, it falls back to the section named by `GH_NOTES_REF` (default: `0.1`).
  - Example: `GH_NOTES_REF=0.1.3 pnpm dlx tsx scripts/release.ts patch`
- **Verification**: After release, check the GitHub Release page to confirm the changelog description appears correctly. If it's missing, the regex may not have matched—verify the CHANGELOG.md format matches `## [X.Y.Z]` exactly.

## Prereleases / Dist-Tags
- To ship a prerelease, publish a GitHub Release marked **Prerelease**.
  - The npm workflow will automatically publish with `--tag next`.

## Rollback / Deprecation
- Prefer deprecation over unpublish:
  - `npm deprecate agentrig@X.Y.Z "Reason…"`
- Only unpublish if necessary and allowed:
  - `npm unpublish agentrig@X.Y.Z --force`
- Create a follow-up patch release that fixes the issue.

## Troubleshooting
- `npm Release` fails (OIDC / permissions / E403):
  - Check the `npm Release` workflow run logs in GitHub Actions.
  - Verify npm package settings → **Trusted Publishers** points to this repo and `npm-release.yml` (and the workflow has `permissions: id-token: write`).
  - Confirm the GitHub Release is **published** (not draft).
  - If needed, manually run the workflow via `workflow_dispatch` with `tag=vX.Y.Z` (and `prerelease=true` to publish to `next`).
- `gh` failures: `gh auth status`; ensure `repo` scope exists.
- Tag push rejected: pull/rebase or fast-forward `main`, then rerun.
