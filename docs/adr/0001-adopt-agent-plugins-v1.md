# ADR 0001: Adopt Agent Plugins v1 as the canonical package contract

- Status: Accepted for implementation
- Date: 2026-08-07
- Owners: `@agentrig/sdk`, CLI, registry, web
- External specification: [Agent Plugins Specification 1.0.0](https://agent-plugins.org/specification)

## Context

AgentRig currently authors, scans, publishes, and materializes an earlier Open Plugins shape. Its source manifest lives at `.plugin/plugin.json`, component locations can be declared in the manifest, and AgentRig metadata lives under `x-agentrig`.

Agent Plugins 1.0.0 is now the portable package contract. It requires a root `plugin.json`, a canonical `$schema`, fixed component locations, and reverse-domain client extensions. The v1 portable component surface contains exactly skills and MCP servers. The specification is currently a Working Draft, so AgentRig must pin the declared schema identifier and treat later specification revisions as explicit migrations.

AgentRig's differentiated responsibilities are not replaced by the package specification. Registry distribution, provenance, trust state, content locks, capability policy, provider-native materialization, update review, and advisory enforcement remain AgentRig-owned concerns.

## Decision

AgentRig will adopt Agent Plugins 1.0.0 as the single canonical package contract for all newly authored, ingested, scanned, published, and materialized plugins.

The canonical portable layout is:

```text
plugin-root/
├── plugin.json
├── skills/
│   └── <skill>/SKILL.md
├── mcp.json
└── ai.agentrig/
    └── ... AgentRig-specific files when required
```

The following invariants apply:

1. `plugin.json` MUST live at the plugin root.
2. `$schema` MUST be `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` for v1 packages.
3. Portable skills MUST be discovered from `skills/*/SKILL.md`.
4. Portable MCP servers MUST be discovered from root `mcp.json` using the matching v1 MCP schema.
5. AgentRig manifest metadata MUST live under `extensions["ai.agentrig"]`.
6. AgentRig-specific package files MUST live under the top-level `ai.agentrig/` extension directory.
7. Commands, agents, hooks, rules, and other provider-specific components are not portable Agent Plugins v1 component types. If AgentRig continues to package them, their source contract belongs to the `ai.agentrig` extension and provider emitters materialize them into native target layouts.
8. The SDK MUST validate package-root containment and the v1 failure boundaries before downstream code consumes a package.
9. Web, CLI, and registry code MUST consume the SDK's canonical parsed package and scan outputs rather than implement another manifest interpretation.

## Hard cut and historical exception

There will be no general dual-schema parser, authoring mode, materializer, or fallback path. New source packages using `.plugin/plugin.json` or `x-agentrig` are non-conformant after the cutover.

One narrow exception exists for immutable registry history that was already published under the previous shape. Existing snapshots containing `.plugin/plugin.json` and `x-agentrig` remain readable as historical external data so old pinned installs stay reproducible. They MUST NOT be rewritten in place, treated as valid new submissions, or used as the authoring shape for a new version. The next published version of such a plugin MUST use Agent Plugins v1.

This exception belongs at the registry snapshot-reading boundary. It MUST NOT leak into the canonical SDK authoring, scanning, publishing, or materialization paths.

## Ownership

`@agentrig/sdk` is the canonical owner of:

- the Agent Plugins v1 manifest and MCP schemas used at runtime;
- package discovery, validation, containment, and typed outputs;
- AgentRig extension schema and semantics;
- scan and materialization inputs consumed by other applications.

The CLI owns user workflows and provider installation. The registry owns immutable publication history and trust state. The web application owns presentation and Convex-safe persistence projections only. Provider adapters own emission into Claude, Codex, and Cursor native layouts, not the source package contract.

## Migration sequence

1. Replace the SDK manifest model with the closed Agent Plugins v1 root schema and `ai.agentrig` extension schema.
2. Replace scanner discovery with root `plugin.json`, fixed `skills/`, root `mcp.json`, and package-containment enforcement.
3. Replace generated and scaffolded package output with the v1 layout; update provider materializers to consume the canonical SDK package.
4. Change publishing and registry validation to accept only v1 for new versions while preserving immutable legacy snapshots through the isolated history reader.
5. Migrate CLI, docs, templates, web inspect, and registry tooling to SDK outputs; remove old Open Plugins terminology and duplicate parsing.
6. Add cross-provider golden tests proving that one v1 source package produces the intended Claude, Codex, and Cursor installations without changing the source contract.

Each step is a hard cut in its owning layer. Temporary migration branches may contain intermediate commits, but released code must not expose both source contracts.

## Consequences

- AgentRig aligns its package boundary with the new ecosystem standard instead of maintaining a competing portable manifest.
- AgentRig keeps its moat above that boundary: trust, reproducibility, policy compilation, updates, advisories, and multi-provider native materialization.
- Existing published versions remain reproducible without making legacy input a permanent public contract.
- Non-portable component support becomes visibly AgentRig-specific rather than appearing to be part of the portable v1 standard.
- Because 1.0.0 is a Working Draft, implementation must pin schemas locally and require an explicit ADR amendment for normative upstream changes.

## Out of scope

This ADR does not redesign the website information architecture, define the project lockfile or firewall IR, or implement `adopt`. Those follow after the v1 package boundary is implemented and verified.
