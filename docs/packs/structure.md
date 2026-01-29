---
title: Pack structure
description: Folder layout, required files, and optional components.
---

## Required

- `meta.json`
- `README.md`
- Any files referenced by `meta.json.files`

## Common layout

```text
my-pack/
  meta.json
  skills/
    my-pack/
      SKILL.md
  scripts/
    helper.sh
  agents/
    reviewer.md
  hooks/
    hooks.json
  .mcp.json
  .lsp.json
```

Notes:

- `skills/` is conventional but not required. The install target controls where files land.
- Optional components (`agents`, `hooks`, `.mcp.json`, `.lsp.json`) are copied when exporting to Claude Code marketplaces.
- File modes can be set per file in `meta.json` (for example `755` for scripts).
