# __PACK_TITLE__

__PACK_DESCRIPTION__

## Installation

```bash
agentrig add __PACK_NAME__
```

Or install from a custom registry:

```bash
agentrig add @your-namespace/__PACK_NAME__
```

## Usage

After installation, the skill will be available in your project. The agent will automatically apply it when relevant tasks are detected.

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
agentrig pack claude-marketplace .
```

## License

MIT © __YEAR__ __PACK_AUTHOR__
