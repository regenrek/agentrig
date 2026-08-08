# __PLUGIN_NAME__

__PLUGIN_DESCRIPTION__

This manifest is compatible with the [Agent Plugins specification](https://agent-plugins.org/specification).

## Publishing

This scaffold is for authoring and local testing. Publish it to a static signed
registry before using the public install command.

## Local testing

```bash
agentrig plugin bundle .
cd ..
agentrig plugin export --agent claude --pluginsDir ./__PLUGIN_ID__ --out dist/claude-marketplace
```

After publishing, install it with the canonical latest-first registry ref:

```bash
agentrig registry add your-registry https://example.com/agentrig
agentrig plugin install codex your-registry/__PLUGIN_ID__
```

## Usage

After installation, the provider plugin will expose this plugin's skills, commands, agents, and related assets in the target environment.

## Structure

```
__PLUGIN_ID__/
├── plugin.json         # Agent Plugins v1 manifest
├── skills/             # Skills directory
│   └── __PLUGIN_SLUG__/  # Main skill
│       └── SKILL.md    # Skill instructions
├── mcp.json            # Portable MCP servers (optional)
├── ai.agentrig/        # AgentRig-specific components (optional)
│   ├── agents/
│   ├── hooks/
│   └── rules/
└── CHANGELOG.md        # Plugin changelog
```

## Development

### Refresh plugin metadata

Update `plugin.json` when plugin identity or public metadata changes.
AgentRig-specific configuration belongs under `extensions["ai.agentrig"]`; AgentRig-specific files belong under `ai.agentrig/`.

### Export for Claude Marketplace

```bash
cd ..
agentrig plugin export --agent claude --pluginsDir ./__PLUGIN_ID__ --out dist/claude-marketplace
```

## License

MIT © __YEAR__ __PLUGIN_AUTHOR__
