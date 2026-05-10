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
  - Commit `chore: release vX.Y.Z`, tag `vX.Y.Z`, push (refuses non-`main` unless `ALLOW_NON_MAIN=1`; `ALLOW_NON_MAIN=true` is rejected)
  - Create/Update a GitHub Release with notes from `CHANGELOG.md`
  - Trigger the GitHub Actions publish workflow (OIDC) on release publish

## Production Migration Runbook
Run these only from an approved prod release window, after confirming the deployed Convex target is prod. The zero-delta verification means mutation-specific write counters return zero on re-run; scan, unchanged, or already-materialized counters may remain nonzero.

1. `20260509_backfill_listing_installability`
   - Command: `pnpm exec convex run --prod migrations/20260509_backfill_listing_installability:backfillListingInstallability`
   - Confirm token literal: **known gap, none currently enforced**. TODO(C-FS-1/Worker α): add a literal confirm token before the next prod run.
   - Expected first-run delta: `listingsTouched`, `listingDigestsTouched`, and/or `orphanDigestsTouched` may be nonzero for legacy rows missing `installability`.
   - Verification: re-run the same command and require `listingsTouched=0`, `listingDigestsTouched=0`, and `orphanDigestsTouched=0`.
   - Idempotency: re-runs return zero write delta.
2. `20260509_backfill_listings_digest`
   - Command: `pnpm exec convex run --prod migrations/20260509_backfill_listings_digest:run`
   - Confirm token literal: **known gap, none currently enforced**. TODO(C-FS-1/Worker α): add a literal confirm token before the next prod run.
   - Expected first-run delta: `created` and/or `updated` may be nonzero while digest rows are materialized.
   - Verification: re-run the same command and require `created=0`, `updated=0`, and `skipped=0`.
   - Idempotency: re-runs return zero write delta.
3. `20260509_collapse_sibling_listings`
   - Command: `pnpm exec convex run --prod migrations/20260509_collapse_sibling_listings:run`
   - Confirm token literal: **known gap, none currently enforced**. TODO(C-FS-1/Worker α): add a literal confirm token before the next prod run.
   - Expected first-run delta: `groupsCollapsed`, `versionsCreated`, `listingsDeleted`, `digestsDeleted`, `headsPatched`, and/or `parentLinksRepaired` may be nonzero while sibling heads collapse.
   - Verification: re-run the same command and require destructive/write deltas (`groupsCollapsed`, `versionsCreated`, `listingsDeleted`, `digestsDeleted`, `parentLinksRepaired`) to be zero.
   - Idempotency: re-runs must return zero write delta; current `headsPatched` may still report scanned heads until Worker α tightens the return contract.
4. `20260509_backfill_marketplace_readmes`
   - Command: `pnpm exec convex run --prod migrations/20260509_backfill_marketplace_readmes:backfillMarketplaceReadmes '{"confirm":"BACKFILL_MARKETPLACE_READMES_DEV_CONFIRM"}'`
   - Confirm token literal: `BACKFILL_MARKETPLACE_READMES_DEV_CONFIRM` (known naming gap for a prod run; TODO(C-FS-1/Worker α): replace with a prod-specific literal if they update the migration).
   - Expected first-run delta: `stored` may be nonzero for listings whose current version snapshot lacks a stored README.
   - Verification: re-run the same command and require `stored=0`; `scanned` may also fall to zero once no candidates remain.
   - Idempotency: re-runs return zero write delta.
5. `20260510_materialize_listings_prod`
   - Command: `pnpm exec convex run --prod migrations/20260510_materialize_listings_prod:run '{"confirm":"MATERIALIZE_LISTINGS_PROD_CONFIRM"}'`
   - Confirm token literal: `MATERIALIZE_LISTINGS_PROD_CONFIRM`
   - Expected first-run delta: `listingsCreated` and/or `versionsCreated` may be nonzero for approved submissions not yet materialized into marketplace listings.
   - Verification: re-run the same command and require `listingsCreated=0`, `versionsCreated=0`, and empty `conflicts`/`skipped`.
   - Idempotency: re-runs return zero write delta.
6. `20260510_remirror_listing_versions_prod`
   - Command: `pnpm exec convex run --prod migrations/20260510_remirror_listing_versions_prod:run '{"confirm":"REMIRROR_LISTING_VERSIONS_PROD_CONFIRM","artifactIds":["regenrek.agent-skills"]}'`
   - Confirm token literal: `REMIRROR_LISTING_VERSIONS_PROD_CONFIRM`
   - Expected first-run delta: `rewritten` contains each targeted stale listing version that was regenerated with the synthesized `.plugin/plugin.json`.
   - Verification: re-run with the same `artifactIds` and require no stale rewrites and empty `skipped`.
   - Idempotency: re-runs should return zero write delta; coordinate with Worker α if the current mutation still reports rewrites for already re-mirrored targets.
7. `20260510_drop_listing_install_bundle`
   - Command: pending Worker α B2 migration landing.
   - Confirm token literal: **TODO(Worker α/B2)**. Do not run until the migration exists with a literal prod confirm token.
   - Expected first-run delta: drops duplicated listing-head `installBundle` data after all version snapshots are verified.
   - Verification: pending Worker α B2; expected verification is a prod Convex run proving no listing heads retain the dropped field.
   - Idempotency: re-runs must return zero write delta.

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
- **Changelog Format**: The section header must exactly match `## [X.Y.Z] - YYYY-MM-DD` where `X.Y.Z` is the version being released (e.g., `## [0.2.8] - 2025-11-22`).
- The extracted changelog section becomes the GitHub Release description, so include clear, user-friendly descriptions of changes.
- If that section is missing, it falls back to the section named by `GH_NOTES_REF` (default: `0.1`).
  - Example: `GH_NOTES_REF=0.1.3 pnpm dlx tsx scripts/release.ts patch`
- **Verification**: After release, check the GitHub Release page to confirm the changelog description appears correctly. If it's missing, verify the CHANGELOG.md format matches `## [X.Y.Z] - YYYY-MM-DD` exactly.

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
- GitHub Release creation fails after the release commit/tag push:
  - Treat the release as incomplete. Create the missing Release with the command printed by `scripts/release.ts`, then trigger `npm-release.yml` via `workflow_dispatch` if it did not start automatically.
- `gh` failures: `gh auth status`; ensure `repo` scope exists.
- Tag push rejected: pull/rebase or fast-forward `main`, then rerun.
