# Rust

Use this skill when working on Rust codebases.

## Guardrails

- Prefer explicit error types and context (`thiserror`, `anyhow`) where appropriate
- Keep `unsafe` scoped and documented
- Avoid premature optimization: benchmark first

## Run checks

```sh
./.codex/skills/rust/rust-check.sh
```
