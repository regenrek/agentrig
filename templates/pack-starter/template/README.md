# __PACK_TITLE__

__PACK_DESCRIPTION__

## Installation

```bash
agentrig plugin install codex __PACK_NAME__
```

Or install from a custom registry:

```bash
agentrig registry add your-registry https://example.com/agentrig
agentrig plugin install codex your-registry/__PACK_NAME__
```

## Usage

After installation, the provider plugin will expose the pack's skills, commands, agents, and related assets in the target environment.

## Structure

```
__PACK_NAME__/
├── meta.json           # Pack metadata
├── skills/             # Skills directory
│   └── __PACK_NAME__/  # Main skill
│       └── SKILL.md    # Skill instructions
├── agents/             # Subagents (optional)
├── hooks/              # Hooks (optional)
│   └── hooks.json
├── .mcp.json           # MCP servers (optional)
└── .lsp.json           # LSP servers (optional)
```

## Development

### Regenerate meta.json

After adding or modifying files:

```bash
agentrig pack create . --out meta.json
```

### Export for Claude Marketplace

```bash
agentrig pack plugin export --agent claude --packsDir . --out dist/claude-marketplace
```

## License

MIT © __YEAR__ __PACK_AUTHOR__
