---
name: publish-npm-homebrew
description: Release Node.js CLI packages to npm (Trusted Publishing/OIDC) and Homebrew (tap auto-update). Use when setting up release automation, publishing a CLI to npm/Homebrew, configuring GitHub Actions for package releases, or when the user asks about npm Trusted Publishing or Homebrew formula generation.
---

# Publish npm + Homebrew

Automated release workflow for Node.js CLI packages with npm Trusted Publishing (OIDC) and Homebrew tap auto-update.

## Prerequisites

- Node 18+, pnpm
- GitHub CLI authenticated (`gh auth status`)
- Clean `main` branch pushed to origin

### First-Time npm Setup

Before Trusted Publishing works, publish manually once to claim the package name:

```bash
npm login
pnpm --filter ./packages/cli build   # or your CLI dir
cd packages/cli && npm publish --access public
```

Then configure Trusted Publishing in npm:
1. Go to https://www.npmjs.com/package/YOUR_PKG → **Settings** → **Publishing access**
2. Add Trusted Publisher: repo `owner/repo`, workflow `npm-release.yml`

### Homebrew Tap Setup

Required GitHub secrets in your repo:
- `HOMEBREW_TAP_APP_ID` – GitHub App ID
- `HOMEBREW_TAP_APP_PRIVATE_KEY` – GitHub App private key (PEM)

The GitHub App must be installed on `owner/homebrew-tap` with **Contents: read/write**.

## Release Workflow

### 1. Update CHANGELOG.md

Add a section matching `## [X.Y.Z] - YYYY-MM-DD`:

```markdown
## [0.2.0] - 2026-01-24
### Added
- New feature X
### Fixed
- Bug Y
```

### 2. Run Tests

```bash
pnpm test:run          # or vitest --run
pnpm coverage          # keep >80%
```

### 3. Release

```bash
pnpm dlx tsx scripts/release.ts patch   # or minor / major
```

The script:
1. Bumps `cli/package.json#version`
2. Builds (`tsup`)
3. Commits `chore: release vX.Y.Z`, tags, pushes
4. Creates GitHub Release with CHANGELOG notes
5. Triggers npm publish via GitHub Actions (OIDC)
6. Triggers Homebrew tap update via GitHub Actions

## Scripts & Workflows

Copy these into your project:

| File | Purpose |
|------|---------|
| `scripts/release.ts` | Version bump, tag, push, create GH release |
| `scripts/homebrew-update.mjs` | Generate Homebrew formula from npm tarball |
| `.github/workflows/npm-release.yml` | Publish to npm on GH Release |
| `.github/workflows/homebrew-release.yml` | Update Homebrew tap on GH Release |

See [scripts/release.ts](scripts/release.ts) and [workflows/](workflows/) for templates.

## Prereleases

Mark the GitHub Release as **Prerelease** → npm publishes with `--tag next`.

## Rollback

```bash
npm deprecate your-pkg@X.Y.Z "Reason"   # prefer over unpublish
npm unpublish your-pkg@X.Y.Z --force    # if necessary
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| npm E403/OIDC fail | Check Trusted Publisher config; ensure GH Release is published (not draft) |
| Homebrew 404 tarball | Rerun `homebrew-release.yml` after npm publish completes |
| Homebrew push 403 | Verify GitHub App secrets and tap repo permissions |
| Tag push rejected | Pull/rebase main, then rerun |
