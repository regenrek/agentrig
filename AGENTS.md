## Non-negotiables
- Ship production-grade, scalable (>1000 users) implementations; avoid MVP/minimal shortcuts.
- Optimize for long-term sustainability: maintainable, reliable designs.
- Make changes the single canonical implementation in the primary codepath; delete legacy/dead/duplicate paths as part of delivery.
- Use direct, first-class integrations; do not introduce shims, wrappers, glue code, or adapter layers.
- Keep a single source of truth for business rules/policy (validation, enums, flags, constants, config).
- Clean API invariants: define required inputs, validate up front, fail fast.
- Use latest stable libs/docs; if unsure, do a web search.
- For artifact catalog work, `@agentrig/sdk` is the canonical owner of artifact
  kind contracts, extraction, closure detection, scan/tree digests, and
  Selection Bundle construction. CLI and web must consume SDK outputs instead of
  duplicating scanner, materializer, closure, or enrichment validation logic.
- Registry installability is the public trust boundary. Directory presence,
  profile ownership, discovery submissions, or AI enrichment never override
  `blocked` or `yanked` registry states.

## Codex behaviour
 - If files change unexpectedly, assume parallel edits and continue; keep your diff scoped. Stop only for conflicts/breakage, then ask the user.
 - When web searching, prefer 2026 (latest) sources/docs unless an older version is explicitly needed.

## Coding Style
- Target <=500 LOC (hard cap 750; imports/types excluded).
- Keep UI/markup nesting <=3 levels; extract components/helpers when JSX/templating repeats, responsibilities pile up, or variant/conditional switches grow.

## Security guards
- No delete/move/overwrite without explicit user request; for deletions prefer `trash` over `rm`.
- Don’t expose secrets in code/logs; use env/secret stores.
- Validate/sanitize untrusted input to prevent injection, path traversal, SSRF, and unsafe uploads.
- Enforce AuthN/AuthZ and tenant boundaries; least privilege.
- Be cautious with new dependencies; flag supply-chain/CVE risk.

## Git operations
- Use `gh` CLI for GitHub operations (issues/PRs/releases).
- Ask before any `git push`.
- Prefer Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, etc.).

## Pull requests
- Keep PRs short and structured: **Why** (1–2 bullets), **How** (1–3 bullets), **Tests** (commands run + results).
- Create/manage PRs via `gh pr ...`.
- Avoid noise (logs/dumps); include only key context, risks, and screenshots when UX changes.
