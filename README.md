# agentrig

![Agentrig banner](public/banner_opt.png)

**Composable AI workflow packs for Claude Code, Codex, and Cursor.**

Agentrig helps you package the prompts, skills, rules, commands, hooks, MCP config, and agent setup that already work for your team, then reuse them across projects without copy-pasting them repo by repo.

This repo includes the `agentrig` CLI, the docs and registry site, and a publishable pack registry.

> Warning: Agentrig is under active development. Expect breaking changes, evolving behavior, and rough edges. Use it at your own risk.

## Features

- `Pack-based workflows`: Define reusable packs with `meta.json` plus the files you want to distribute.
- `Registry distribution`: Install packs from a hosted registry, a direct URL, or a local file.
- `Rig composition`: Group packs into named rigs so projects can opt into a consistent setup.
- `Multi-provider plugins`: Export the same pack as a native plugin for Claude Code, Codex, and Cursor.
- `Docs + browser`: Ship a docs site and registry browser alongside the CLI.

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
pnpm install
pnpm registry:build
pnpm docs:dev
```

In another terminal:

```bash
pnpm dev:cli -- init
pnpm dev:cli -- list --available --registry http://localhost:5173/registry
pnpm dev:cli -- add core-committer --registry http://localhost:5173/registry
```

The default pack install target directory is `.codex/skills` (configurable).

## Repo workflow

1. `Install dependencies`

```bash
pnpm install
```

2. `Build the local registry into the docs app's public output`

```bash
pnpm registry:build
```

3. `Run the docs site, which also serves registry JSON and pack files`

```bash
pnpm docs:dev
```

4. `Use the CLI against the local registry`

```bash
pnpm dev:cli -- init
pnpm dev:cli -- list --available --registry http://localhost:5173/registry
pnpm dev:cli -- add core-committer --registry http://localhost:5173/registry
```

## Publish your registry

The built registry output is:

- `apps/docs/public/registry/registry.json`
- `apps/docs/public/registry/<pack>.json`
- `apps/docs/public/registry/packs/<pack>/**` (the actual files)

You can deploy the docs site anywhere that serves static files. The CLI only needs a base URL that contains `/registry.json`.

## Plugin export

If you want your packs to be installable as local plugins, agentrig can export each pack as a provider-native plugin for Claude Code, Codex, Cursor, or all three at once.

Build every supported provider:

```bash
pnpm plugins:build
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
agentrig pack plugin install --agent codex --pack my-pack --scope auto
agentrig pack plugin install --agent cursor --pack my-pack --scope workspace
```

For Claude, agentrig calls the native `claude plugin marketplace add` and `claude plugin install` commands.
For Codex, it updates a local marketplace manifest and copies plugins into `~/.codex/plugins/` or `./plugins/`.
For Cursor, `--scope personal` copies plugins into `~/.cursor/plugins/local/`.
For Cursor, explicit `--scope workspace` copies plugins into `<cwd>/.cursor/plugins/local/` using AgentRig's project-local convention.
Cursor `--scope auto` still resolves to `personal`.

You can customize marketplace names, owners, and prefixes in `agentrig.plugins.json`. The older `agentrig.marketplace.json` file is still supported for Claude-only settings.

## Create a pack

Create a new folder:

```
registry/packs/<your-pack>/
  meta.json
  skills/<skill-name>/SKILL.md
  skills/<skill-name>/<scripts>
```

Then rebuild the registry:

```bash
pnpm registry:build
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

## Shared setup across projects

You can keep shared rigs and registries in a global config:

```bash
agentrig init --global
```

Then in each repo, write a minimal project config that only sets the default rig (and optionally skillsDir):

```bash
agentrig init --minimal --defaultRig tauri-agentic
```

`agentrig` merges `~/.agentrig/config.json` and `./agentrig.config.json` (project overrides global).
