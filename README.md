# agentrig

![Agentrig banner](public/banner_opt.png)

**Install reusable AI workflow packs from registries as native Claude Code, Codex, and Cursor plugins.**

AgentRig has one consumer story:

- `agentrig init`
- `agentrig list --available`
- `agentrig plugin install <provider> <spec>`

Third-party registries are explicit:

- `agentrig registry add <alias> <baseUrl>`
- `agentrig list --available --registry <alias>`
- `agentrig plugin install <provider> <alias>/<pack>`

Rigs and pack authoring still exist, but they are secondary workflows for teams and publishers.

This repo contains the `agentrig` CLI, the docs site, and the official registry source.

> Warning: AgentRig is under active development. Expect breaking changes while the product contract settles.

## Install the CLI

```bash
npm install -g agentrig
agentrig --help
```

Full documentation lives at [docs.agentrig.ai](https://docs.agentrig.ai/).

## Consumer Quickstart

Use the official registry:

```bash
agentrig init
agentrig list --available
agentrig plugin install codex core-committer
```

Inspect a pack before installing it:

```bash
agentrig view core-committer
```

Add a third-party registry before using it:

```bash
agentrig registry add georg https://georg.dev/agentrig
agentrig list --available --registry georg
agentrig plugin install cursor georg/ts-master-pack
```

Direct URLs and local `meta.json` files are treated as unlisted sources and require confirmation:

```bash
agentrig plugin install codex ./my-pack/meta.json --yes
```

## Core Model

- `packs` are the portable unit
- `registries` are how packs are discovered and distributed
- `provider plugins` are the consumer delivery target
- `rigs` are an advanced named set of pack specs for teams

The CLI can resolve a pack spec from:

- the seeded `official` registry
- an explicitly added third-party registry via `registryAlias/pack-name`
- a direct `meta.json` URL
- a direct local `meta.json` path

## Provider Plugins

Consumers install and remove plugins from resolved pack specs:

```bash
agentrig plugin install claude core-committer
agentrig plugin install codex georg/ts-master-pack --scope workspace
agentrig plugin uninstall codex georg/ts-master-pack --scope workspace
```

AgentRig tracks plugin installs in its own ledger so uninstall keeps working even if a registry is later removed or temporarily offline.

## Author Packs

Scaffold a local pack:

```bash
agentrig pack init my-pack
agentrig pack create my-pack
```

Export local packs as provider-native plugin marketplaces:

```bash
agentrig pack plugin export --agent all --packsDir registry/packs --out dist/plugins
```

Advanced teams can apply multiple pack specs at once with rigs:

```bash
agentrig rig apply codex my-rig --scope workspace
```

## Documentation

- [Getting Started](https://docs.agentrig.ai/getting-started)
- [Integrations](https://docs.agentrig.ai/integrations)
- [CLI Reference](https://docs.agentrig.ai/cli)
- [Packs](https://docs.agentrig.ai/packs)
- [Registry](https://docs.agentrig.ai/registry)
