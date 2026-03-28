# Manual E2E: Full Pack Workflow

This runbook is for manually validating the full AgentRig pack workflow end to end:

1. Create a realistic pack from scratch.
2. Add multiple skills plus MCP, app, rules, commands, agents, hooks, scripts, and assets.
3. Export the pack to `claude`, `codex`, and `cursor`.
4. Install the exported plugin through AgentRig.
5. Verify provider-specific output, install ledgers, and uninstall behavior.

Use a scratch directory so this does not mix with a real project.

## Goals

- Exercise `agentrig pack init`.
- Exercise provider export with `--agent all`.
- Exercise provider install for Claude, Codex, and Cursor.
- Verify both workspace-local and personal install paths where supported.
- Verify uninstall removes only AgentRig-managed state.

## Prerequisites

- `agentrig` is installed and runnable.
- `node` is available.
- `claude` CLI is installed if you want to test Claude install/uninstall.
- Codex is installed if you want to test Codex install/uninstall.
- Cursor is installed if you want to test Cursor install/uninstall.
- `jq` is optional but helpful for inspecting JSON.

## Suggested Scratch Workspace

```bash
export AGENTRIG_E2E_ROOT="/tmp/agentrig-manual-e2e"
export AGENTRIG_E2E_PACKS_ROOT="$AGENTRIG_E2E_ROOT/packs"
export AGENTRIG_E2E_PROJECT_A="$AGENTRIG_E2E_ROOT/project-a"
export AGENTRIG_E2E_PROJECT_B="$AGENTRIG_E2E_ROOT/project-b"
rm -rf "$AGENTRIG_E2E_ROOT"
mkdir -p "$AGENTRIG_E2E_PACKS_ROOT"
cd "$AGENTRIG_E2E_ROOT"
```

## Step 0: Seed Disposable Vite+ Projects

Create one primary workspace-install target and one secondary clean project by copying the committed Vite+ playground fixture.
This is the canonical consumer-app baseline used by the automated subprocess tests, so the manual and automated flows stay aligned.

```bash
mkdir -p "$AGENTRIG_E2E_PROJECT_A" "$AGENTRIG_E2E_PROJECT_B"

cp -R "/absolute/path/to/agentrig-public/test/playgrounds/vite-plus-application/." "$AGENTRIG_E2E_PROJECT_A/"
cp -R "/absolute/path/to/agentrig-public/test/playgrounds/vite-plus-application/." "$AGENTRIG_E2E_PROJECT_B/"

for project in "$AGENTRIG_E2E_PROJECT_A" "$AGENTRIG_E2E_PROJECT_B"; do
  (
    cd "$project"
    pnpm install
    pnpm run build
    agentrig init --registry https://agentrig.ai/registry
  )
done
```

Expected result:

- `project-a/` exists as a disposable Vite+ application project.
- `project-b/` exists as a second clean Vite+ application project.
- Both projects build successfully before AgentRig writes its config.
- Both projects contain `agentrig.config.json`.

Recommended usage:

- Use `project-a` for the main workspace install/uninstall flow.
- Use `project-b` for a second clean-room check when you want to re-run a provider install from scratch.

## Step 1: Create The Pack

```bash
agentrig pack init full-e2e-pack \
  --dir "$AGENTRIG_E2E_PACKS_ROOT" \
  --title "Full E2E Pack" \
  --description "Manual end-to-end pack for provider export testing." \
  --author "AgentRig Manual Test"
```

Expected result:

- `packs/full-e2e-pack/` exists.
- `packs/full-e2e-pack/meta.json` exists.
- `packs/full-e2e-pack/README.md` exists.

## Step 2: Add Full-Fidelity Pack Contents

Change into the pack:

```bash
cd "$AGENTRIG_E2E_PACKS_ROOT/full-e2e-pack"
```

Add multiple skills:

```bash
mkdir -p skills/reviewer skills/releaser

cat > skills/reviewer/SKILL.md <<'EOF'
---
name: reviewer
description: Review code changes for quality and safety.
---

Review code carefully.
Focus on regressions, missing tests, and risky edge cases.
EOF

cat > skills/releaser/SKILL.md <<'EOF'
---
name: releaser
description: Prepare release notes and run safe release steps.
---

Check changelog quality.
Confirm release prerequisites before shipping.
EOF
```

Add commands, agents, rules, hooks, scripts, and assets:

```bash
mkdir -p commands agents rules hooks scripts assets

cat > commands/deploy.md <<'EOF'
# deploy

Use this command when preparing a release or deployment.
EOF

cat > agents/reviewer.md <<'EOF'
# reviewer

You are a careful reviewer focused on bugs, regressions, and missing tests.
EOF

cat > rules/prefer-const.mdc <<'EOF'
---
description: Prefer const over let when values do not change.
alwaysApply: true
---

Prefer `const` unless reassignment is required.
EOF

cat > hooks/hooks.json <<'EOF'
{
  "hooks": {
    "PostToolUse": []
  }
}
EOF

cat > scripts/echo-status.sh <<'EOF'
#!/usr/bin/env bash
set -eu
echo "full-e2e-pack ok"
EOF
chmod +x scripts/echo-status.sh

cat > assets/notes.txt <<'EOF'
Manual test asset file.
EOF
```

Add MCP and app config:

```bash
cat > .mcp.json <<'EOF'
{
  "mcpServers": {
    "demo": {
      "command": "node",
      "args": ["-e", "console.log('demo mcp server')"]
    }
  }
}
EOF

cat > .app.json <<'EOF'
{
  "apps": []
}
EOF
```

Add Claude-oriented optional files:

```bash
cat > settings.json <<'EOF'
{
  "permissions": {
    "allow": ["Bash(*)"]
  }
}
EOF

cat > .lsp.json <<'EOF'
{
  "servers": {}
}
EOF
```

Expected result:

- The pack now contains `skills/`, `commands/`, `agents/`, `rules/`, `hooks/`, `scripts/`, `assets/`, `.mcp.json`, `.app.json`, `settings.json`, and `.lsp.json`.
- There are at least two skills under `skills/`.

## Step 3: Optional Metadata Scan Check

This does not replace `meta.json`; it only exercises `pack create` into a separate file.

```bash
agentrig pack create . --out ../full-e2e-pack.generated-meta.json
```

Expected result:

- `packs/full-e2e-pack.generated-meta.json` exists.
- The generated file includes the pack name and version.

## Step 4: Export To All Providers

Go back to the scratch root:

```bash
cd "$AGENTRIG_E2E_ROOT"
```

Export one pack to all provider formats:

```bash
agentrig pack plugin export \
  --agent all \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --out "$AGENTRIG_E2E_ROOT/dist/plugins" \
  --clean
```

Expected result:

- `dist/plugins/claude/` exists.
- `dist/plugins/codex/` exists.
- `dist/plugins/cursor/` exists.

## Step 5: Verify Exported Claude Output

Check these files:

```text
dist/plugins/claude/.claude-plugin/marketplace.json
dist/plugins/claude/plugins/agentrig-full-e2e-pack/.claude-plugin/plugin.json
dist/plugins/claude/plugins/agentrig-full-e2e-pack/skills/
dist/plugins/claude/plugins/agentrig-full-e2e-pack/commands/
dist/plugins/claude/plugins/agentrig-full-e2e-pack/agents/
dist/plugins/claude/plugins/agentrig-full-e2e-pack/.mcp.json
dist/plugins/claude/plugins/agentrig-full-e2e-pack/settings.json
dist/plugins/claude/plugins/agentrig-full-e2e-pack/.lsp.json
```

Expected result:

- The plugin manifest name is `agentrig-full-e2e-pack`.
- Claude plugin manifest includes `commands`.
- Claude plugin manifest includes `agents`.
- Claude export contains the copied `.mcp.json`, `settings.json`, and `.lsp.json`.

## Step 6: Verify Exported Codex Output

Check these files:

```text
dist/plugins/codex/.agents/plugins/marketplace.json
dist/plugins/codex/plugins/agentrig-full-e2e-pack/.codex-plugin/plugin.json
dist/plugins/codex/plugins/agentrig-full-e2e-pack/skills/
dist/plugins/codex/plugins/agentrig-full-e2e-pack/.mcp.json
dist/plugins/codex/plugins/agentrig-full-e2e-pack/.app.json
```

Expected result:

- Codex plugin manifest includes `skills: "./skills/"`.
- Codex plugin manifest includes `mcpServers: "./.mcp.json"`.
- Codex plugin manifest includes `apps: "./.app.json"`.
- Codex marketplace entry points to `./plugins/agentrig-full-e2e-pack`.

## Step 7: Verify Exported Cursor Output

Check these files:

```text
dist/plugins/cursor/.cursor-plugin/marketplace.json
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/.cursor-plugin/plugin.json
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/rules/
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/skills/
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/agents/
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/commands/
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/hooks/hooks.json
dist/plugins/cursor/plugins/agentrig-full-e2e-pack/mcp.json
```

Expected result:

- Cursor plugin manifest includes `rules: "./rules"`.
- Cursor plugin manifest includes `skills: "./skills"`.
- Cursor plugin manifest includes `agents: "./agents"`.
- Cursor plugin manifest includes `commands: "./commands"`.
- Cursor plugin manifest includes `hooks: "./hooks/hooks.json"`.
- Cursor plugin manifest includes `mcpServers: "./mcp.json"`.
- Exported `mcp.json` contains `"mcpServers"`.

## Step 8: Install Into Codex Workspace Scope

```bash
cd "$AGENTRIG_E2E_PROJECT_A"

agentrig pack plugin install \
  --agent codex \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope workspace \
  --clean
```

Expected result:

- `plugins/agentrig-full-e2e-pack/` exists in `project-a`.
- `.agents/plugins/marketplace.json` exists in `project-a`.
- `.agentrig/plugin-installs.json` exists in `project-a`.
- The workspace ledger contains `codex:workspace:agentrig-full-e2e-pack`.

## Step 9: Install Into Cursor Workspace Scope

```bash
agentrig pack plugin install \
  --agent cursor \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope workspace \
  --clean
```

Expected result:

- `.cursor/plugins/local/agentrig-full-e2e-pack/` exists in `project-a`.
- `.agentrig/plugin-installs.json` contains `cursor:workspace:agentrig-full-e2e-pack`.

## Step 10: Install Into Claude Workspace Scope

```bash
agentrig pack plugin install \
  --agent claude \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope workspace \
  --clean
```

Expected result:

- The command prints the install plan first.
- Claude marketplace add/install completes successfully.
- `.agentrig/plugin-installs.json` contains `claude:workspace:agentrig-full-e2e-pack`.

## Step 11: Install Personal Scope Variants

Run these only if you want to validate personal installs too:

```bash
cd "$AGENTRIG_E2E_PROJECT_A"

agentrig pack plugin install \
  --agent codex \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope personal \
  --clean

agentrig pack plugin install \
  --agent cursor \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope personal \
  --clean

agentrig pack plugin install \
  --agent claude \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope personal \
  --clean
```

Expected result:

- Codex personal install appears under `~/.codex/plugins/agentrig-full-e2e-pack`.
- Cursor personal install appears under `~/.cursor/plugins/local/agentrig-full-e2e-pack`.
- `~/.agentrig/plugin-installs.json` contains personal-scope records for successful installs.

## Step 12: Safety Check Before Uninstall

To verify hash-guarded uninstall behavior, modify one installed file in a workspace install before uninstalling:

```bash
echo "manual edit" >> "$AGENTRIG_E2E_PROJECT_A/.cursor/plugins/local/agentrig-full-e2e-pack/README.md"
echo "manual edit" >> "$AGENTRIG_E2E_PROJECT_A/plugins/agentrig-full-e2e-pack/README.md"
```

Expected result:

- These edits should cause AgentRig to keep those changed files instead of deleting them outright during uninstall.

## Step 13: Uninstall Workspace Installs

```bash
cd "$AGENTRIG_E2E_PROJECT_A"

agentrig pack plugin uninstall --agent cursor --pack full-e2e-pack --scope workspace
agentrig pack plugin uninstall --agent codex --pack full-e2e-pack --scope workspace
agentrig pack plugin uninstall --agent claude --pack full-e2e-pack --scope workspace
```

Expected result:

- Cursor and Codex uninstall remove unchanged AgentRig-managed files.
- Any modified file is reported as kept instead of deleted.
- Workspace ledger entries are removed only for installs that were fully cleared.
- Claude uninstall completes without touching unrelated pre-existing marketplace state.

## Step 13b: Optional Clean-Room Reinstall In Project B

If you want a second workspace validation from a totally clean project, run one provider in `project-b`:

```bash
cd "$AGENTRIG_E2E_PROJECT_B"

agentrig pack plugin install \
  --agent cursor \
  --pack full-e2e-pack \
  --packsDir "$AGENTRIG_E2E_PACKS_ROOT" \
  --scope workspace \
  --clean

agentrig pack plugin uninstall --agent cursor --pack full-e2e-pack --scope workspace
```

Expected result:

- `project-b` can install the same exported pack without relying on state from `project-a`.
- Workspace-local plugin files and ledger state are created only inside `project-b`.
- Uninstall returns `project-b` to a clean state.

## Step 14: Uninstall Personal Installs

If you ran the personal installs, remove them too:

```bash
agentrig pack plugin uninstall --agent cursor --pack full-e2e-pack --scope personal
agentrig pack plugin uninstall --agent codex --pack full-e2e-pack --scope personal
agentrig pack plugin uninstall --agent claude --pack full-e2e-pack --scope personal
```

Expected result:

- `~/.cursor/plugins/local/agentrig-full-e2e-pack` is removed if unchanged.
- `~/.codex/plugins/agentrig-full-e2e-pack` is removed if unchanged.
- `~/.agentrig/plugin-installs.json` no longer contains personal records for `agentrig-full-e2e-pack`.

## Pass Criteria

Consider this run successful when all of the following are true:

- `pack init` created a valid starting pack.
- The full-feature pack exported successfully to all three providers.
- Claude export includes commands and agents.
- Codex export includes skills, `.mcp.json`, and `.app.json`.
- Cursor export includes rules, skills, commands, hooks, and `mcp.json`.
- Workspace installs succeed for Claude, Codex, and Cursor.
- At least one disposable test project in `/tmp` works as a clean workspace-install target.
- A second disposable project can be used for clean-room retesting without state leakage.
- Personal installs succeed for the providers you tested.
- Install ledgers are written for successful installs.
- Uninstall removes only AgentRig-managed state.
- Modified installed files are kept rather than deleted.

## Cleanup

Remove the scratch workspace when finished:

```bash
rm -rf "$AGENTRIG_E2E_ROOT"
```
