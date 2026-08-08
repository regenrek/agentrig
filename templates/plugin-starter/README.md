# agentrig Plugin Starter Template

This is the default template for creating new agentrig plugins.
Generated manifests follow the [Agent Plugins specification](https://agent-plugins.org/specification), with AgentRig-specific configuration under `extensions["ai.agentrig"]`.

## Usage

This template is automatically used by:

```bash
agentrig plugin init acme.my-plugin
```

## Template Variables

The following placeholders are replaced during scaffolding:

| Placeholder | Description |
|-------------|-------------|
| `__PLUGIN_ID__` | Canonical Agent Plugins name (`namespace.plugin`) |
| `__PLUGIN_SLUG__` | Plugin slug (the segment after `.`) |
| `__PLUGIN_NAME__` | Human-readable plugin name |
| `__PLUGIN_DESCRIPTION__` | Plugin description |
| `__PLUGIN_AUTHOR__` | Author name |
| `__YEAR__` | Current year |

## Structure

```
template/
├── plugin.json   # Plugin metadata template
├── README.md             # Plugin README
├── _gitignore            # .gitignore (renamed during copy)
└── skills/
    └── __PLUGIN_SLUG__/
        └── SKILL.md    # Main skill template
```

## Extending

To add more components to the template:

- `mcp.json` - portable MCP server configuration
- `ai.agentrig/agents/<name>.md` - AgentRig subagent definitions
- `ai.agentrig/hooks/hooks.json` - AgentRig hook definitions
- `ai.agentrig/lsp.json` - AgentRig LSP configuration
- `ai.agentrig/scripts/` - AgentRig utility scripts
