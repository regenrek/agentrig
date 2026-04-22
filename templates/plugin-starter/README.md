# agentrig Plugin Starter Template

This is the default template for creating new agentrig plugins.

## Usage

This template is automatically used by:

```bash
agentrig plugin init my-plugin
```

## Template Variables

The following placeholders are replaced during scaffolding:

| Placeholder | Description |
|-------------|-------------|
| `__PLUGIN_ID__` | Plugin id (lowercase, hyphenated) |
| `__PLUGIN_NAME__` | Human-readable plugin name |
| `__PLUGIN_DESCRIPTION__` | Plugin description |
| `__PLUGIN_AUTHOR__` | Author name |
| `__YEAR__` | Current year |

## Structure

```
template/
├── .plugin/plugin.json # Plugin metadata template
├── README.md           # Plugin README
├── _gitignore          # .gitignore (renamed during copy)
└── skills/
    └── __PLUGIN_ID__/
        └── SKILL.md    # Main skill template
```

## Extending

To add more components to the template:

- `agents/<name>.md` - Subagent definitions
- `hooks/hooks.json` - Hook definitions
- `.mcp.json` - MCP server configuration
- `.lsp.json` - LSP server configuration
- `scripts/` - Utility scripts
