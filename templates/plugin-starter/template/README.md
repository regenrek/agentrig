# __PLUGIN_NAME__

__PLUGIN_DESCRIPTION__

## Publishing

This scaffold is for authoring and local testing. Publish it to a static signed
registry before using the public install command.

## Local testing

```bash
agentrig plugin bundle .
cd ..
agentrig plugin export --agent claude --pluginsDir ./__PLUGIN_ID__ --out dist/claude-marketplace
```

After publishing, install it with the canonical registry ref:

```bash
agentrig registry add your-registry https://example.com/agentrig
agentrig plugin install codex your-registry/__PLUGIN_ID__@0.1.0
```

## Usage

After installation, the provider plugin will expose this plugin's skills, commands, agents, and related assets in the target environment.

## Structure

```
__PLUGIN_ID__/
├── .plugin/
│   └── plugin.json     # Plugin manifest
├── skills/             # Skills directory
│   └── __PLUGIN_SLUG__/  # Main skill
│       └── SKILL.md    # Skill instructions
├── agents/             # Subagents (optional)
├── hooks/              # Hooks (optional)
│   └── hooks.json
├── rules/              # Rule files (optional)
├── .mcp.json           # MCP servers (optional)
├── .lsp.json           # LSP servers (optional)
└── CHANGELOG.md        # Plugin changelog
```

## Development

### Refresh plugin metadata

Update `.plugin/plugin.json` when plugin identity or public metadata changes.

### Export for Claude Marketplace

```bash
cd ..
agentrig plugin export --agent claude --pluginsDir ./__PLUGIN_ID__ --out dist/claude-marketplace
```

## License

MIT © __YEAR__ __PLUGIN_AUTHOR__
