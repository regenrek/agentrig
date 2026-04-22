# AgentRig

![Agentrig banner](public/banner_opt.png)

AgentRig lets you create, install, and share AI workflow plugins for tools like Claude Code, Codex, and Cursor.

A plugin can include skills, agents, MCP servers, commands, hooks, and related files.

## Install the CLI

```bash
npm install -g agentrig
agentrig --help
```

Docs: [docs.agentrig.ai](https://docs.agentrig.ai/)

## Install a plugin

```bash
agentrig init
agentrig list --available
agentrig view agentrig/agentrig.core-committer@0.1.0
agentrig plugin install codex agentrig/agentrig.core-committer@0.1.0
```

`agentrig init` adds the official registry to your config.  
Public install refs use `<registryAlias>/<namespace.plugin>@<version>`.

## Add another registry

```bash
agentrig registry add georg https://georg.dev/agentrig
agentrig list --available --registry georg
agentrig plugin install cursor georg/georg.ts-master-plugin@1.2.0
```

## Create a plugin

```bash
agentrig plugin init my-plugin
agentrig plugin create my-plugin
```

## Export or apply plugins

```bash
agentrig plugin export --agent all --pluginsDir ../agentrig-registry/plugins --out dist/plugins
agentrig rig apply codex my-rig --scope workspace
```

## A few terms

- `plugin` - a bundle of AI workflow files
- `registry` - a source of installable plugin versions
- `directory` - a discovery surface
- `provider` - where the plugin gets installed
- `rig` - a named setup that applies multiple plugins together

## Documentation

- [Getting Started](https://docs.agentrig.ai/getting-started)
- [CLI Reference](https://docs.agentrig.ai/cli)
- [Plugins](https://docs.agentrig.ai/plugins)
- [Registry](https://docs.agentrig.ai/registry)
