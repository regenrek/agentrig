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

## Install selected artifacts

Plugins can bundle skills, MCPs, hooks, commands, and agents. AgentRig exposes
skills, MCPs, and hooks as first-class selectable artifacts while keeping the
local install/uninstall atom as one managed Selection Bundle:

```bash
agentrig install codex agentrig/community.typescript@0.1.0 \
  --pick skill:best-practice-coding \
  --pick skill:computer-use-skill
```

Kind-specific helpers route to the same selection-bundle install path:

```bash
agentrig skill install codex agentrig/community.typescript@0.1.0 --pick best-practice-coding
agentrig mcp install cursor agentrig/acme.devtools@1.0.0 --pick github
agentrig hook install claude agentrig/acme.workflow@1.0.0 --pick pre-submit
```

Selection installs are closure-checked by `@agentrig/sdk`. The CLI does not
install a selected artifact when SDK closure reports missing dependencies or
files outside the selected artifact root. MCP and hook JSON writes are
hash-owned; uninstall removes only AgentRig-written values that still match the
ledger.

## Inspect or reuse a repo

```bash
agentrig inspect jxnl/dots
agentrig use jxnl/dots --as-plugin acme.dots-pick --pick skills/foo
agentrig use jxnl/dots --install --provider codex --pick prompts/review
```

Repo inspection is deterministic. `agentrig use <repo>` records external-repo
provenance and never pretends the repo is a signed registry entry.

Optional CLI enrichment is local BYOK only:

```bash
export AGENTRIG_AI_BASE_URL="https://api.openai.com/v1"
export AGENTRIG_AI_API_KEY="..."
export AGENTRIG_AI_MODEL="gpt-4.1-mini"
export AGENTRIG_AI_MAX_TOKENS="2000" # optional; useful for reasoning models
agentrig use jxnl/dots --as-plugin acme.dots-pick --pick skills/foo --enrich-ai=local
```

The CLI calls your OpenAI-compatible provider directly with plain `fetch`.
AgentRig servers never receive your provider key. Hosted AI enrichment is web-only
in v1, gated by login, Turnstile, quotas, and admin review.

## Add another registry

```bash
agentrig registry add georg https://georg.dev/agentrig
agentrig list --available --registry georg
agentrig plugin install cursor georg/georg.ts-master-plugin@1.2.0
```

## Create a plugin

```bash
agentrig plugin init acme.my-plugin
agentrig plugin create acme.my-plugin
```

## Export or apply plugins

```bash
agentrig plugin export --agent all --pluginsDir ../agentrig-registry/plugins --out dist/plugins
agentrig rig apply codex my-rig --scope workspace
```

## A few terms

- `plugin` - a bundle of AI workflow files
- `artifact` - a plugin, skill, MCP, hook, command, or agent
- `Selection Bundle` - one AgentRig-managed install/uninstall ledger record for selected artifacts
- `registry` - a source of installable plugin versions
- `directory` - a discovery surface
- `external-repo` - local provenance for scanned repo reuse, not registry trust

## Build warnings

SDK builds may emit a `[PLUGIN_TIMINGS] Warning` from the Vite+/plugin timing
instrumentation layer. It is diagnostic build telemetry, not artifact catalog
policy, scan digest, materialization, or runtime behavior. Treat new warning
classes as review findings unless they are traced and documented here.
- `provider` - where the plugin gets installed
- `rig` - a named setup that applies multiple plugins together

## Documentation

- [Getting Started](https://docs.agentrig.ai/getting-started)
- [CLI Reference](https://docs.agentrig.ai/cli)
- [Plugins](https://docs.agentrig.ai/plugins)
- [Registry](https://docs.agentrig.ai/registry)
