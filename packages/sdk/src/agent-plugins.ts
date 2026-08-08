import { z } from 'zod'
import { isValidPluginName } from './provider/plugin-names'

export const AGENT_PLUGINS_VERSION = '1.0.0' as const
export const AGENT_PLUGIN_MANIFEST_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' as const
export const AGENT_PLUGIN_MCP_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' as const
export const AGENTRIG_EXTENSION_NAMESPACE = 'ai.agentrig' as const

export const PLUGIN_PROFILES = ['kit-entry', 'base', 'core', 'project', 'third-party', 'other'] as const
export const PROVIDER_TARGETS = ['codex', 'claude-code', 'cursor'] as const
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export const CAPABILITY_IDS = [
  'plan.ledger',
  'docs.latest',
  'browser.verify',
  'repo.remote',
  'ci.status',
  'repo.security',
  'deploy.preview',
  'observability.logs',
  'mcp.verify',
  'secrets.scan',
  'supplychain.scan',
  'shell.lint',
  'desktop.runtime',
  'native.debug',
] as const

const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const YYYY_MM_DD_RE = /^\d{4}-\d{2}-\d{2}$/
const CAPABILITY_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$/

export const PluginProfileSchema = z.enum(PLUGIN_PROFILES)
export const ProviderTargetSchema = z.enum(PROVIDER_TARGETS)
export const RiskLevelSchema = z.enum(RISK_LEVELS)
export const CapabilityIdSchema = z.string().regex(
  CAPABILITY_ID_RE,
  'Capability id must match the AgentRig capability id pattern',
)

export type PluginProfile = z.infer<typeof PluginProfileSchema>
export type ProviderTarget = z.infer<typeof ProviderTargetSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>
export type CapabilityId = z.infer<typeof CapabilityIdSchema>

const AgentPluginAuthorSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
  })
  .strict()

const AgentRigPluginListingSchema = z
  .object({
    category: z.string().trim().min(1),
  })
  .strict()

const AgentRigProvidedCapabilitySchema = z
  .object({
    type: z.enum(['tool', 'workflow', 'ledger', 'scanner', 'runtime']),
    requiredByCore: z.boolean(),
    riskLevel: RiskLevelSchema.optional(),
    fallback: z.string().trim().min(1).optional(),
  })
  .strict()

const AgentRigRequiredCapabilitySchema = z
  .object({
    required: z.boolean(),
    provider: z.string().trim().min(1).optional(),
    fallback: z.string().trim().min(1).optional(),
  })
  .strict()

const AgentRigVerificationSchema = z
  .object({
    lastVerified: z.string().regex(YYYY_MM_DD_RE, 'lastVerified must use YYYY-MM-DD format'),
    cadence: z.string().trim().min(1),
    smokeTest: z.string().trim().min(1),
    commandFingerprint: z.string().regex(SHA256_DIGEST_RE, 'commandFingerprint must be a sha256:<hex> digest').optional(),
  })
  .strict()

const AgentRigReplacementPolicySchema = z
  .object({
    capabilities: z.array(CapabilityIdSchema).min(1),
    replaceWithoutCourseChange: z.boolean(),
  })
  .strict()

const AgentRigSecuritySchema = z
  .object({
    requiresConsent: z.boolean(),
    showsExactCommands: z.boolean(),
    requiresEnvVars: z.array(z.string().trim()),
    notes: z.string().trim().min(1).optional(),
  })
  .strict()

const AgentRigRiskSchema = z
  .object({
    level: RiskLevelSchema,
    notes: z.string().trim().min(1).optional(),
  })
  .strict()

export const AgentRigPluginExtensionSchema = z
  .object({
    displayName: z.string().optional(),
    kind: z.string().trim().min(1).optional(),
    profile: PluginProfileSchema.optional(),
    owner: z.string().trim().min(1).optional(),
    supportLevel: z.string().trim().min(1).optional(),
    listing: AgentRigPluginListingSchema.optional(),
    configSchema: z.record(z.string(), z.unknown()).optional(),
    pluginDependencies: z.array(z.string().trim().min(1)).optional(),
    publicSkills: z.array(z.string().trim().min(1)).optional(),
    supportSkills: z.array(z.string().trim().min(1)).optional(),
    optionalCapabilities: z.array(CapabilityIdSchema).optional(),
    requiredCapabilities: z.record(CapabilityIdSchema, AgentRigRequiredCapabilitySchema).optional(),
    aliases: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
    providerTargets: z.array(ProviderTargetSchema).optional(),
    providesCapabilities: z.record(CapabilityIdSchema, AgentRigProvidedCapabilitySchema).optional(),
    verification: AgentRigVerificationSchema.optional(),
    security: AgentRigSecuritySchema.optional(),
    replacementPolicy: AgentRigReplacementPolicySchema.optional(),
    risk: AgentRigRiskSchema.optional(),
    permissions: z.record(z.string(), z.unknown()).optional(),
    source: z.unknown().optional(),
  })
  .strict()

const ExtensionObjectSchema = z.record(z.string(), z.unknown())
const AgentPluginExtensionsSchema = z
  .object({
    [AGENTRIG_EXTENSION_NAMESPACE]: AgentRigPluginExtensionSchema.optional(),
  })
  .catchall(ExtensionObjectSchema)

const AgentPluginManifestObjectSchema = z
  .object({
    $schema: z.literal(AGENT_PLUGIN_MANIFEST_SCHEMA_URL),
    name: z.string().refine(
      isValidPluginName,
      'Agent Plugin name must be 1-64 lowercase letters, numbers, dots, or hyphens; start and end alphanumeric; and not contain "--" or ".."',
    ),
    version: z.string().optional(),
    description: z.string().optional(),
    author: AgentPluginAuthorSchema.optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    extensions: AgentPluginExtensionsSchema.optional(),
  })
  .strip()

export const PluginManifestSchema = z.preprocess((value) => {
  if (!isRecord(value) || value.extensions === undefined || isRecord(value.extensions)) return value
  const { extensions: _ignored, ...manifest } = value
  return manifest
}, AgentPluginManifestObjectSchema)

export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type AgentRigPluginExtension = z.infer<typeof AgentRigPluginExtensionSchema>

export function agentRigPluginExtension(manifest: Pick<PluginManifest, 'extensions'>): AgentRigPluginExtension | undefined {
  return manifest.extensions?.[AGENTRIG_EXTENSION_NAMESPACE]
}

export type PluginSkillResolution = {
  plugin: string
  requestedName: string
  canonicalName: string
  matched: 'canonical' | 'alias'
}

export function resolvePluginSkillName(
  manifest: Pick<PluginManifest, 'name' | 'extensions'>,
  requestedName: string
): PluginSkillResolution | null {
  const requested = requestedName.trim()
  if (!requested) return null
  const extension = agentRigPluginExtension(manifest)
  const declaredNames = new Set(
    [...(extension?.publicSkills ?? []), ...(extension?.supportSkills ?? [])]
      .map((name) => name.trim())
      .filter(Boolean),
  )
  if (declaredNames.has(requested)) {
    return { plugin: manifest.name, requestedName: requested, canonicalName: requested, matched: 'canonical' }
  }
  const aliasTarget = extension?.aliases?.[requested]?.trim()
  if (!aliasTarget || (declaredNames.size > 0 && !declaredNames.has(aliasTarget))) return null
  return { plugin: manifest.name, requestedName: requested, canonicalName: aliasTarget, matched: 'alias' }
}

export function pluginManifestListingCategory(manifest: Pick<PluginManifest, 'name' | 'extensions'>) {
  const category = agentRigPluginExtension(manifest)?.listing?.category?.trim()
  if (!category) {
    throw new Error(`Plugin ${manifest.name} is missing extensions["ai.agentrig"].listing.category.`)
  }
  return category
}

const StringRecordSchema = z.record(z.string(), z.string())

const StdioMcpServerSchema = z
  .object({
    type: z.literal('stdio'),
    command: z.string().min(1).refine(isExecutableToken, 'command must be a bare executable or a plugin-relative ./ path'),
    args: z.array(z.string()).optional(),
    env: StringRecordSchema.refine(
      (env) => !Object.hasOwn(env, 'PLUGIN_ROOT') && !Object.hasOwn(env, 'PLUGIN_DATA'),
      'env must not define PLUGIN_ROOT or PLUGIN_DATA',
    ).optional(),
    cwd: z.string().regex(
      /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/,
      'cwd must be plugin-relative, PLUGIN_ROOT-rooted, or PLUGIN_DATA-rooted',
    ).optional(),
  })
  .strict()

const HttpHeadersSchema = StringRecordSchema.superRefine((headers, ctx) => {
  const seen = new Set<string>()
  for (const name of Object.keys(headers)) {
    const normalized = name.toLowerCase()
    if (seen.has(normalized)) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'Header names must be unique case-insensitively' })
    }
    seen.add(normalized)
  }
})

function remoteMcpServerSchema(type: 'streamable-http' | 'sse') {
  return z
    .object({
      type: z.literal(type),
      url: z.string().min(1).refine(isAllowedMcpUrl, 'url must be HTTPS, or HTTP on an exact loopback host, without credentials or fragments'),
      headers: HttpHeadersSchema.optional(),
    })
    .strict()
}

export const AgentPluginMcpServerSchema = z.discriminatedUnion('type', [
  StdioMcpServerSchema,
  remoteMcpServerSchema('streamable-http'),
  remoteMcpServerSchema('sse'),
])

export const AgentPluginMcpDocumentSchema = z
  .object({
    $schema: z.literal(AGENT_PLUGIN_MCP_SCHEMA_URL),
    mcpServers: z.record(z.string(), z.unknown()),
  })
  .strict()

export const AgentPluginMcpConfigSchema = z
  .object({
    $schema: z.literal(AGENT_PLUGIN_MCP_SCHEMA_URL),
    mcpServers: z.record(z.string(), AgentPluginMcpServerSchema),
  })
  .strict()

export type AgentPluginMcpServer = z.infer<typeof AgentPluginMcpServerSchema>
export type AgentPluginMcpConfig = z.infer<typeof AgentPluginMcpConfigSchema>

function isExecutableToken(command: string) {
  if (/\s/.test(command)) return false
  if (command.startsWith('./')) return command.length > 2 && !command.split('/').includes('..')
  return !command.includes('/') && !command.includes('\\')
}

function isAllowedMcpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && isLoopbackHost(url.hostname)
}

function isLoopbackHost(hostname: string) {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
  const octets = hostname.split('.').map(Number)
  return octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 127
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
