#!/usr/bin/env sh
set -eu

echo "== rust checks =="

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found"
  exit 1
fi

cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
