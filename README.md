# agentrig

![Agentrig banner](public/banner_opt.png)

**Composable AI workflow packs for portable, provider-native integrations.**

Agentrig helps you package the prompts, skills, rules, commands, hooks, MCP config, and agent setup that already work for your team, then reuse them across projects without rebuilding the same workflow for every repo or tool.

At its core, AgentRig gives you three layers: packs as the building blocks, rigs as the team-ready composition layer, and provider-native delivery for where people actually work.

This repo includes the `agentrig` CLI, the docs and registry site, and a publishable pack registry.

![How Agentrig standardizes and reuses AI workflows across projects and tools](public/agentrig_explanation.jpg)

> Warning: Agentrig is under active development. Expect breaking changes, evolving behavior, and rough edges. Use it at your own risk.

## Why AgentRig

- `Reusable workflow packs`: Package skills, MCP config, agents, hooks, commands, rules, and setup into registry-installable packs that can be shared across projects.
- `Composable rigs for teams`: Group packs into opinionated setups so repos and teams can adopt a consistent workflow without copy-pasting configuration.
- `Native delivery where people work`: Export the same packs and rigs as provider-native integrations for Claude Code, Codex, and Cursor, with tracked installs and safe cleanup.

## Install the CLI

Install the official CLI from npm:

```bash
npm install -g agentrig
```

Then:

```bash
agentrig --help
```

Full documentation and examples live at [docs.agentrig.ai](https://docs.agentrig.ai/).

## What is a pack?

A pack is a folder that contains:

- `meta.json` (metadata + file install plan)
- Any files you want to distribute (for example `skills/**/SKILL.md` + scripts)

The CLI can install a pack from:

- A configured registry (`registry.json` + `r/<name>.json`)
- A direct `meta.json` URL
- A direct local `meta.json` path

## Quickstart

```bash
agentrig init
agentrig list --available
agentrig add <pack-name>
```

The default pack install target directory is `.codex/skills` (configurable).

## Plugin export

If you want your packs to be installable as local plugins, agentrig can export each pack as a provider-native plugin for Claude Code, Codex, Cursor, or all three at once.

### How plugin export and install works

![How AgentRig converts packs into native plugins and tracks installs safely](public/agentrig_plugin.jpeg)

- Start with an AgentRig pack as the portable source of truth for prompts, assets, scripts, MCP config, and other workflow files.
- `agentrig pack plugin export` converts that pack into each provider's native plugin marketplace layout for Claude Code, Codex, or Cursor.
- `agentrig pack plugin install` installs the native output into the provider-specific target location instead of inventing a separate runtime format.
- AgentRig records install state in its ledger so uninstall can remove only tracked files, preserve user-modified files, and keep plugin cleanup auditable.
Export all supported providers:

```bash
agentrig pack plugin export --agent all --packsDir registry/packs --out dist/plugins
```

Or export a single provider directly:

```bash
agentrig pack plugin export --agent claude --packsDir registry/packs --out dist/claude-marketplace
agentrig pack plugin export --agent codex --packsDir registry/packs --out dist/codex-marketplace
agentrig pack plugin export --agent cursor --packsDir registry/packs --out dist/cursor-marketplace
```

This generates provider-native outputs such as:

```text
dist/plugins/
  claude/
    .claude-plugin/marketplace.json
    plugins/agentrig-<pack>/
  codex/
    .agents/plugins/marketplace.json
    plugins/agentrig-<pack>/
  cursor/
    .cursor-plugin/marketplace.json
    plugins/agentrig-<pack>/
```

Install into local providers:

```bash
agentrig pack plugin install --agent claude --pack my-pack
agentrig pack plugin install --agent codex --pack my-pack --scope auto
agentrig pack plugin install --agent cursor --pack my-pack --scope workspace
agentrig pack plugin uninstall --agent codex --pack my-pack
```

For Claude, agentrig calls the native `claude plugin marketplace add` and `claude plugin install` commands.
For Codex, it updates a local marketplace manifest and copies plugins into `~/.codex/plugins/` or `./plugins/`.
For Cursor, `--scope personal` copies plugins into `~/.cursor/plugins/local/`.
For Cursor, explicit `--scope workspace` copies plugins into `<cwd>/.cursor/plugins/local/` using AgentRig's project-local convention.
Cursor `--scope auto` still resolves to `personal`.

You can customize marketplace names, owners, and prefixes in `agentrig.plugins.json`.

AgentRig also tracks the plugin installs it manages, so uninstall can remove only what AgentRig added, keep modified files in place, and reduce hidden plugin/config bloat over time.

## Create a pack

Create a new folder:

```
registry/packs/<your-pack>/
  meta.json
  skills/<skill-name>/SKILL.md
  skills/<skill-name>/<scripts>
```

If your pack also needs provider-specific plugin components, add these folders at the pack root:

```
registry/packs/<your-pack>/
  commands/
    <command>.md
  agents/
    <agent>.md
  rules/
    <rule>.mdc
  hooks/
    hooks.json
  .mcp.json
  .app.json
```

They'll be copied into exported provider plugins when that provider supports them.

## Documentation

- [Getting Started](https://docs.agentrig.ai/getting-started)
- [CLI Reference](https://docs.agentrig.ai/cli)
- [Integrations](https://docs.agentrig.ai/integrations)
- [Packs](https://docs.agentrig.ai/packs)
- [Registry](https://docs.agentrig.ai/registry)

## Registry model

This project follows the same shape as the shadcn registry concept:

- A `registry.json` index at the registry root
- Per-item JSON documents under `r/<name>.json`
- Item JSON references file paths instead of inlining file content
