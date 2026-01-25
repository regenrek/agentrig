# Security Check

Use this skill before releasing, merging, or publishing.

## What it checks

This is intentionally lightweight and best-effort:

- Detects secrets in tracked files using common patterns
- Runs dependency audits if a package manager is detected
- Suggests language-specific scanners if present

## How to run

```sh
./.codex/skills/security-check/security-check.sh
```

## Notes

- For serious secret scanning, add a dedicated tool like gitleaks in CI.
- This script is designed to be fast and not require extra dependencies.
