export type RealRepoCase = {
  id: string
  source: string
  description: string
  minSignals: number
}

// Community, non-normalized repos from the current agent-rules / skills ecosystem.
// Intentionally excludes awesome lists, catalogs, and pure link directories.
export const REAL_REPO_CASES: RealRepoCase[] = [
  {
    id: 'flow-next',
    source: 'gmickel/flow-next',
    description: 'plan-first workflow plugin',
    minSignals: 1,
  },
  {
    id: 'cclsp',
    source: 'ktnyt/cclsp',
    description: 'MCP-to-LSP bridge for coding agents',
    minSignals: 1,
  },
  {
    id: 'claude-lsp-cli',
    source: 'teamchong/claude-lsp-cli',
    description: 'Claude Code diagnostics and typecheck CLI',
    minSignals: 1,
  },
  {
    id: 'serena',
    source: 'oraios/serena',
    description: 'semantic retrieval and editing MCP toolkit',
    minSignals: 1,
  },
  {
    id: 'rust-skills',
    source: 'actionbook/rust-skills',
    description: 'Rust-focused Claude Code skills',
    minSignals: 1,
  },
  {
    id: 'nuxt-skills',
    source: 'onmax/nuxt-skills',
    description: 'Nuxt and Vue skills for coding assistants',
    minSignals: 1,
  },
  {
    id: 'tauri-skills',
    source: 'dchuk/claude-code-tauri-skills',
    description: 'Tauri v2 Claude Code skills',
    minSignals: 1,
  },
  {
    id: 'hono-electron',
    source: 'naporin0624/claude-plugin-hono-electron',
    description: 'Electron plugin with Hono RPC and type-safe IPC',
    minSignals: 1,
  },
  {
    id: 'ok-skills',
    source: 'mxyhi/ok-skills',
    description: 'cross-tool skills and AGENTS playbooks',
    minSignals: 1,
  },
  {
    id: 'codex-skills-library',
    source: 'proflead/codex-skills-library',
    description: 'Codex-native skills library',
    minSignals: 1,
  },
  {
    id: 'patrity-nuxt-skills',
    source: 'Patrity/nuxt-skills',
    description: 'Nuxt 4 and Nuxt UI focused skills',
    minSignals: 1,
  },
  {
    id: 'solidj-skills',
    source: 'lvcoi/solidJSkills',
    description: 'SolidJS skills and MCP-oriented repo',
    minSignals: 1,
  },
  {
    id: 'solidjs-claude-skill-package',
    source: 'OpenAEC-Foundation/SolidJS-Claude-Skill-Package',
    description: 'structured SolidJS Claude skill package',
    minSignals: 1,
  },
  {
    id: 'solid-ai-rules',
    source: 'vallafederico/solid-ai-rules',
    description: 'SolidJS rules and examples',
    minSignals: 1,
  },
]
