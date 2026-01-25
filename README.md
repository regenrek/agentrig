# agentrig

A monorepo that contains:

- `agentrig` CLI (TypeScript, built with `citty`)
- A simple web registry UI (Vite + Solid)
- A local registry data folder you can publish (pack `meta.json` + files)

The goal is to make it easy to compose "skills" and "workflows" as packs, then apply them per-project without having to redeclare the same lists everywhere.

## What is a pack?

A pack is a folder that contains:

- `meta.json` (metadata + file install plan)
- Any files you want to distribute (for example `skills/**/SKILL.md` + scripts)

The CLI can install a pack from:

- A configured registry (`registry.json` + `r/<name>.json`)
- A direct `meta.json` URL
- A direct local `meta.json` path

## Quick start (this repo)

1) Install deps:

```bash
pnpm install
```

2) Build the local registry into the web app's `public/registry` directory:

```bash
pnpm registry:build
```

3) Run the web UI (also serves the registry JSON and pack files):

```bash
pnpm dev:web
```

4) In another terminal, run the CLI:

```bash
pnpm dev:cli -- init
pnpm dev:cli -- list --available --registry http://localhost:5173/registry
pnpm dev:cli -- add core-committer --registry http://localhost:5173/registry
```

The default install target directory is `.codex/skills` (configurable).

## Publish your registry

The built registry output is:

- `apps/web/public/registry/registry.json`
- `apps/web/public/registry/<pack>.json`
- `apps/web/public/registry/packs/<pack>/**` (the actual files)

You can deploy the web app anywhere that serves static files. The CLI only needs a base URL that contains `/registry.json`.

## Export packs as a Claude Code plugin marketplace (Option A)

If you want your packs to be installable via Claude Code's marketplace UI (`/plugin`), you can export each pack as its own Claude plugin, and generate a marketplace catalog.

Build the marketplace output:

```bash
pnpm claude:marketplace:build
```

This generates a self-contained marketplace folder at:

```
dist/claude-marketplace/
  .claude-plugin/marketplace.json
  plugins/
    agentrig-<pack>/
      .claude-plugin/plugin.json
      skills/...
      commands/... (if present in the pack)
      agents/... (if present in the pack)
```

Test locally in Claude Code:

```text
/plugin marketplace add ./dist/claude-marketplace
/plugin install agentrig-core-committer@agentrig-community
```

Then use the plugin's namespaced commands/skills (for example):

```text
/agentrig-core-committer:committer
```

You can customize the marketplace name, owner, and plugin prefix in `agentrig.marketplace.json`.

## Contributing a pack

Create a new folder:

```
registry/packs/<your-pack>/
  meta.json
  skills/<skill-name>/SKILL.md
  skills/<skill-name>/<scripts>
```

Then run:

```bash
pnpm registry:build
```

If your pack also needs Claude commands or agents, add these folders at the pack root:

```
registry/packs/<your-pack>/
  commands/
    <command>.md
  agents/
    <agent>.md
```

They'll be copied into the exported Claude plugin automatically.

## Registry format inspiration

This project follows the same shape as the shadcn registry concept:

- A `registry.json` index at the registry root
- Per-item JSON documents under `r/<name>.json`
- Item JSON references file paths instead of inlining file content



## DRY setup across many projects

You can keep shared rigs and registries in a global config:

```bash
agentrig init --global
```

Then in each repo, write a minimal project config that only sets the default rig (and optionally skillsDir):

```bash
agentrig init --minimal --defaultRig tauri-agentic
```

`agentrig` merges `~/.agentrig/config.json` and `./agentrig.config.json` (project overrides global).
