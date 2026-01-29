/** @deprecated Use NamespacedRegistry instead */
export type RegistryRef = {
  name: string
  url: string
}

export type RigDefinition = {
  extends?: string[]
  packs?: string[]
}

/**
 * Namespaced registry configuration (shadcn-style).
 * Can be a simple URL template string or an object with auth options.
 */
export type NamespacedRegistryConfig =
  | string // URL template with {name} placeholder, e.g. "https://example.com/{name}.json"
  | {
      url: string
      headers?: Record<string, string>
      params?: Record<string, string>
    }

/**
 * Directory index entry for a community registry.
 */
export type DirectoryEntry = {
  name: string // Namespace identifier, e.g. "@acme"
  homepage?: string
  url: string // URL template with {name} placeholder
  description?: string
  logo?: string
  verified?: boolean
  tags?: string[]
}

/**
 * Trust tier for registry sources.
 */
export type TrustTier = 'official' | 'listed' | 'unlisted'

export type AgentRigConfig = {
  $schema?: string
  skillsDir?: string
  /** @deprecated Use namespacedRegistries instead */
  registries?: RegistryRef[]
  /** Namespaced registries: @namespace -> URL template or config object */
  namespacedRegistries?: Record<string, NamespacedRegistryConfig>
  rigs?: Record<string, RigDefinition>
  defaultRig?: string
}

export type RegistryIndexItem = {
  name: string
  title: string
  description: string
  version?: string
  tags?: string[]
  meta: string
}

export type RegistryIndex = {
  $schema?: string
  name: string
  homepage?: string
  generatedAt?: string
  items: RegistryIndexItem[]
}

export type PackFile = {
  /** File path in the pack source (registry, repo, local folder) */
  path: string
  /** Target path in the consuming project (supports placeholders like {{skillsDir}}) */
  target: string
  /** Optional file mode as a string, ex: "755" */
  mode?: string
  /** Optional sha256 integrity hash (hex) */
  sha256?: string
}

/**
 * Claude plugin component declarations for pack exports.
 */
export type PackComponents = {
  /** Skills included in this pack */
  skills?: string[]
  /** Subagents included in this pack */
  agents?: string[]
  /** Whether this pack includes hooks (hooks/hooks.json) */
  hooks?: boolean
  /** Whether this pack includes MCP servers (.mcp.json) */
  mcp?: boolean
  /** Whether this pack includes LSP servers (.lsp.json) */
  lsp?: boolean
}

/**
 * Hook definition for Claude plugin hooks.
 */
export type HookEventName =
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'Setup'
  | 'SessionStart'
  | 'SessionEnd'

export type HookCommandType = 'command' | 'prompt'

export type HookDefinition = {
  /** Hook event: PreToolUse, PostToolUse, Stop, etc. */
  type: HookEventName
  /** Matcher for tool names (glob pattern) */
  matcher?: string
  /** Hook scripts to run */
  hooks: Array<{
    type?: HookCommandType
    command?: string
    prompt?: string
    timeout?: number
    condition?: string
  }>
}

/**
 * Subagent definition for Claude plugin agents.
 */
export type AgentDefinition = {
  name: string
  description: string
  /** Allowed tools (glob patterns) */
  tools?: string[]
  /** Disallowed tools (glob patterns) */
  disallowedTools?: string[]
  /** Model to use */
  model?: string
  /** Permission mode: default, permissive, strict */
  permissionMode?: 'default' | 'permissive' | 'strict'
  /** Skills to preload for this agent */
  skills?: string[]
  /** Hooks for this agent */
  hooks?: HookDefinition[]
}

export type PackMeta = {
  $schema?: string
  kind?: 'agentrig:pack'
  name: string
  title: string
  description: string
  version: string
  author?: string
  license?: string
  tags?: string[]
  topics?: Record<string, string[]>
  rigDependencies?: string[]
  files: PackFile[]
  /** Claude plugin components included in this pack */
  components?: PackComponents
}

export type InstalledFile = {
  target: string
  sha256?: string
  mode?: string
}

export type InstalledPack = {
  name: string
  version: string
  source: string
  installedAt: string
  files: InstalledFile[]
}

export type Manifest = {
  schemaVersion: 1
  installed: Record<string, InstalledPack>
}
