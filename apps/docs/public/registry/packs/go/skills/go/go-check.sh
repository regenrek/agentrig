#!/usr/bin/env sh
set -eu

echo "== go checks =="

if ! command -v go >/dev/null 2>&1; then
  echo "go not found"
  exit 1
fi

go fmt ./...
go vet ./...
go test ./...
