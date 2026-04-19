export type RegistryRef = {
  name: string
  url: string
}

export type RigDefinition = {
  extends?: string[]
  /** Plugin specs: official plugin, registryAlias/plugin, or explicit manifest spec */
  plugins?: string[]
}

/**
 * Directory index entry for a community registry.
 */
export type DirectoryEntry = {
  name: string
  homepage?: string
  url: string
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
  registries?: RegistryRef[]
  rigs?: Record<string, RigDefinition>
  defaultRig?: string
}

export type RegistryIndexItem = {
  id: string
  name: string
  description: string
  version?: string
  keywords?: string[]
  manifest: string
}

export type RegistryIndex = {
  $schema?: string
  name: string
  homepage?: string
  generatedAt?: string
  items: RegistryIndexItem[]
}

export type PluginFile = {
  /** File path in the plugin source (registry, repo, local folder) */
  path: string
  /** Optional file mode as a string, ex: "755" */
  mode?: string
  /** Optional sha256 integrity hash (hex) */
  sha256?: string
}

export type PluginInstallMetadata = {
  $schema?: string
  files: PluginFile[]
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

export type PluginManifest = {
  $schema?: string
  kind: 'agentrig:plugin'
  id: string
  name: string
  description: string
  version: string
  author?: string
  license?: string
  keywords?: string[]
  pluginDependencies?: string[]
  configSchema: Record<string, unknown>
  'x-agentrig'?: Record<string, unknown>
}

export type PluginProviderName = 'claude' | 'codex' | 'cursor'
export type PluginInstallScopeName = 'personal' | 'workspace'
export type PluginInstallScopeSelectorName = 'auto' | PluginInstallScopeName

export type PluginInstalledFile = {
  path: string
  sha256: string
}

export type CodexMarketplacePluginSource = {
  source: 'local'
  path: string
}

export type CodexMarketplacePluginPolicy = {
  installation: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE'
  authentication: 'ON_INSTALL' | 'ON_FIRST_USE'
}

export type CodexMarketplacePluginRecord = {
  name: string
  source: CodexMarketplacePluginSource
  policy: CodexMarketplacePluginPolicy
  category: string
}

export type PluginInstallSpecIdentity =
  | {
      kind: 'registry'
      registryUrl: string
      pluginId: string
    }
  | {
      kind: 'url'
      manifestUrl: string
    }
  | {
      kind: 'file'
      manifestPath: string
    }

type PluginInstallRecordBase = {
  id: string
  provider: PluginProviderName
  requestedScope: PluginInstallScopeSelectorName
  specIdentity: PluginInstallSpecIdentity
  scope: PluginInstallScopeName
  pluginId: string
  pluginVersion: string
  pluginName: string
  sourceLocation: string
  targetPaths: string[]
  installedAt: string
}

export type ClaudePluginInstallRecord = PluginInstallRecordBase & {
  provider: 'claude'
  files: []
  metadata: {
    marketplaceName: string
    pluginRef: string
    scopeArg: 'user' | 'project'
    marketplaceSourcePath: string
    marketplaceAdded: boolean
  }
}

export type CodexPluginInstallRecord = PluginInstallRecordBase & {
  provider: 'codex'
  files: PluginInstalledFile[]
  metadata: {
    pluginPath: string
    marketplacePath: string
    marketplaceEntry: CodexMarketplacePluginRecord
  }
}

export type CursorPluginInstallRecord = PluginInstallRecordBase & {
  provider: 'cursor'
  files: PluginInstalledFile[]
  metadata: {
    pluginPath: string
  }
}

export type PluginInstallRecord =
  | ClaudePluginInstallRecord
  | CodexPluginInstallRecord
  | CursorPluginInstallRecord

export type PluginInstallLedger = {
  schemaVersion: 1
  installs: Record<string, PluginInstallRecord>
}

export type CliAuthIdentity = {
  userId: string
  email?: string
  name?: string
}

export type CliAuthSession = CliAuthIdentity & {
  baseUrl: string
  accessToken: string
  expiresAt: number
}

export type CliLoginStart = {
  requestId: string
  publicCode: string
  exchangeSecret: string
  expiresAt: number
  verificationUrl: string
}

export type CliLoginExchange =
  | {
      status: 'pending'
      expiresAt: number
    }
  | {
      status: 'expired'
      expiresAt: number
    }
  | {
      status: 'approved'
      accessToken: string
      expiresAt: number
      user: CliAuthIdentity
    }

export type CliWhoAmI = {
  userId: string
  email?: string | null
  name?: string | null
}

export type PluginUploadPolicySnapshot = {
  maxZipBytes: number
  maxFileBytes: number
  maxTotalBytes: number
  maxFiles: number
  allowedContentTypes: string[]
  blockedExtensions: string[]
  allowedFileExtensions: string[]
  allowedFilenames: string[]
  allowedTargetPrefixes: string[]
  publishedVersionRetention: number
}

export type PluginBundle = {
  directory: string
  bundlePath: string
  fileName: string
  manifest: PluginManifest
  zipBytes: Uint8Array
  temporary: boolean
}

export type PluginSubmissionValidationResult = {
  manifest: PluginManifest
  fileCount: number
  totalBytes: number
  zipBytes: number
  warnings: string[]
}

export type PluginUploadUrlResponse = {
  uploadUrl: string
}

export type PluginSubmissionCreateResponse = {
  submissionId: string
  deduped: boolean
}

export type SubmissionIssue = {
  severity: 'error' | 'warning'
  category: string
  code: string
  message: string
}

export type PluginSubmissionStatus = {
  _id: string
  fileName: string
  upstream_repo?: string
  upstream_tag?: string
  upstream_commit_sha?: string
  plugin_path?: string
  status: string
  scanStatus: string
  issues?: SubmissionIssue[]
  scanErrors?: string[]
  scanWarnings?: string[]
  reviewStatus?: string
  reviewNote?: string
  pluginManifest?: unknown
  pluginId?: string
  pluginVersion?: string
  createdAt: number
  updatedAt: number
}

export type PluginSubmissionListResponse = {
  submissions: PluginSubmissionStatus[]
}
