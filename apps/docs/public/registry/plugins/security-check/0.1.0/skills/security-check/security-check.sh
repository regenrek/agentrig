#!/usr/bin/env sh
set -eu

echo "== agentrig security-check =="

# Basic secret grep (best-effort, not exhaustive)
echo ""
echo "[1/3] Quick secret patterns (best-effort)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Scan only tracked files to avoid node_modules noise
  files=$(git ls-files)
else
  files=$(find . -type f -maxdepth 4 2>/dev/null || true)
fi

# Common patterns: AWS keys, GitHub tokens, private keys
# shellcheck disable=SC2086
echo "$files" | xargs -I{} sh -c '
  f="{}"
  [ -f "$f" ] || exit 0
  # Skip huge files
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  [ "$size" -gt 2000000 ] && exit 0
  grep -nE "AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY" "$f" >/dev/null 2>&1 && echo "Potential secret in: $f"
' || true

echo ""
echo "[2/3] Dependency audit (best-effort)"
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  pnpm audit || true
elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
  npm audit || true
elif [ -f bun.lockb ] && command -v bun >/dev/null 2>&1; then
  bun audit || true
else
  echo "No supported JS package manager lockfile detected (or tool not installed). Skipping."
fi

echo ""
echo "[3/3] Language-specific suggestions"
if [ -f Cargo.lock ]; then
  echo "- Rust detected. Consider: cargo audit (via cargo-audit)"
fi
if [ -f go.sum ]; then
  echo "- Go detected. Consider: govulncheck"
fi

echo ""
echo "Done."
