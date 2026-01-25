# agentrig Pack Starter Template

This is the default template for creating new agentrig packs.

## Usage

This template is automatically used by:

```bash
agentrig pack init my-pack
```

## Template Variables

The following placeholders are replaced during scaffolding:

| Placeholder | Description |
|-------------|-------------|
| `__PACK_NAME__` | Pack name (lowercase, hyphenated) |
| `__PACK_TITLE__` | Human-readable title |
| `__PACK_DESCRIPTION__` | Pack description |
| `__PACK_AUTHOR__` | Author name |
| `__YEAR__` | Current year |

## Structure

```
template/
├── meta.json           # Pack metadata template
├── README.md           # Pack README
├── _gitignore          # .gitignore (renamed during copy)
└── skills/
    └── __PACK_NAME__/
        └── SKILL.md    # Main skill template
```

## Extending

To add more components to the template:

- `agents/<name>.md` - Subagent definitions
- `hooks/hooks.json` - Hook definitions
- `.mcp.json` - MCP server configuration
- `.lsp.json` - LSP server configuration
- `scripts/` - Utility scripts
