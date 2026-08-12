import { z } from 'zod'
import {
  AGENTRIG_EXTENSION_NAMESPACE,
  AGENT_PLUGIN_MCP_SCHEMA_URL,
  AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
  AgentPluginMcpDocumentSchema,
  AgentPluginMcpServerSchema,
  AgentRigPluginExtensionSchema,
  type AgentPluginMcpServer,
  PortablePluginManifestSchema,
  type AgentRigPluginExtension,
  type PortablePluginManifest,
} from './agent-plugins'
import { validateAgentSkill, type AgentSkill, type AgentSkillSource } from './agent-skills'

const PORTABLE_MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
])

export type AgentPluginDiagnosticSeverity = 'warning' | 'error' | 'fatal'

export type AgentPluginDiagnostic = {
  code: string
  severity: AgentPluginDiagnosticSeverity
  path: string
  message: string
  publishBlocking: boolean
}

export type InspectedAgentPluginPackage = {
  manifest: PortablePluginManifest
  agentRig?: AgentRigPluginExtension
}

export type AgentPluginPackageInspection = {
  package: InspectedAgentPluginPackage | null
  diagnostics: AgentPluginDiagnostic[]
  conformance: {
    loadable: boolean
    portable: boolean
    publishable: boolean
  }
  components: {
    skills: AgentSkill[]
    mcpServers: Array<{ name: string; server: AgentPluginMcpServer }>
  }
}

export class AgentPluginPackageError extends Error {
  readonly inspection: AgentPluginPackageInspection

  constructor(message: string, inspection: AgentPluginPackageInspection) {
    super(message)
    this.name = 'AgentPluginPackageError'
    this.inspection = inspection
  }
}

export type AgentPluginPackageInput = {
  manifest: unknown
  skills?: readonly AgentSkillSource[]
  mcp?: { path: 'mcp.json'; content: string }
}

export type AgentPluginMcpInspection = {
  diagnostics: AgentPluginDiagnostic[]
  servers: Array<{ name: string; server: AgentPluginMcpServer }>
}

export function inspectAgentPluginPackage(input: AgentPluginPackageInput): AgentPluginPackageInspection {
  const diagnostics: AgentPluginDiagnostic[] = []
  if (!isRecord(input.manifest)) {
    return rejectedInspection(diagnostics, 'manifest.not-object', 'plugin.json', 'plugin.json must contain an object.')
  }

  for (const field of Object.keys(input.manifest)) {
    if (PORTABLE_MANIFEST_FIELDS.has(field)) continue
    diagnostics.push({
      code: 'manifest.unknown-field',
      severity: 'warning',
      path: field,
      message: `Unknown top-level field "${field}" was ignored.`,
      publishBlocking: true,
    })
  }

  const manifestCandidate = { ...input.manifest }
  const rawExtensions = manifestCandidate.extensions
  delete manifestCandidate.extensions

  const extensions: Record<string, Record<string, unknown>> = {}
  if (rawExtensions !== undefined && !isRecord(rawExtensions)) {
    diagnostics.push({
      code: 'manifest.extensions.not-object',
      severity: 'warning',
      path: 'extensions',
      message: 'The non-object extensions field was ignored.',
      publishBlocking: true,
    })
  } else if (rawExtensions) {
    for (const [namespace, value] of Object.entries(rawExtensions)) {
      if (!isRecord(value)) {
        diagnostics.push({
          code: 'manifest.extension.not-object',
          severity: 'warning',
          path: `extensions.${namespace}`,
          message: `Extension "${namespace}" was ignored because it is not an object.`,
          publishBlocking: true,
        })
        continue
      }
      extensions[namespace] = value
    }
  }

  const portableResult = PortablePluginManifestSchema.safeParse({
    ...manifestCandidate,
    ...(Object.keys(extensions).length ? { extensions } : {}),
  })
  if (!portableResult.success) {
    const unsupportedVersion = input.manifest.$schema !== undefined
      && input.manifest.$schema !== AGENT_PLUGIN_MANIFEST_SCHEMA_URL
    diagnostics.push(...zodDiagnostics(portableResult.error, unsupportedVersion))
    return inspection(null, diagnostics)
  }

  let manifest = portableResult.data
  let agentRig: AgentRigPluginExtension | undefined
  const rawAgentRig = extensions[AGENTRIG_EXTENSION_NAMESPACE]
  if (rawAgentRig) {
    const extensionResult = AgentRigPluginExtensionSchema.safeParse(rawAgentRig)
    if (extensionResult.success) {
      agentRig = extensionResult.data
    } else {
      diagnostics.push(...extensionResult.error.issues.map((issue): AgentPluginDiagnostic => ({
        code: 'extension.ai-agentrig.invalid',
        severity: 'error',
        path: ['extensions', AGENTRIG_EXTENSION_NAMESPACE, ...issue.path].join('.'),
        message: issue.message,
        publishBlocking: true,
      })))
      const { [AGENTRIG_EXTENSION_NAMESPACE]: _invalid, ...validExtensions } = manifest.extensions ?? {}
      manifest = {
        ...manifest,
        ...(Object.keys(validExtensions).length ? { extensions: validExtensions } : { extensions: undefined }),
      }
    }
  }

  const skills = inspectSkills(input.skills, diagnostics)
  const mcpServers = inspectMcp(input.mcp, diagnostics)
  if (agentRig && input.skills) validateAgentRigSkillReferences(agentRig, skills, diagnostics)

  return inspection({ manifest, ...(agentRig ? { agentRig } : {}) }, diagnostics, { skills, mcpServers })
}

export function loadAgentPluginPackage(input: AgentPluginPackageInput): InspectedAgentPluginPackage {
  const result = inspectAgentPluginPackage(input)
  if (!result.package) throw new AgentPluginPackageError('Agent Plugin package is not loadable.', result)
  return result.package
}

export function assertPublishableAgentPluginPackage(input: AgentPluginPackageInput): InspectedAgentPluginPackage {
  const result = inspectAgentPluginPackage(input)
  if (!result.package || !result.conformance.publishable) {
    throw new AgentPluginPackageError('Agent Plugin package is not publishable.', result)
  }
  return result.package
}

function rejectedInspection(
  diagnostics: AgentPluginDiagnostic[],
  code: string,
  path: string,
  message: string,
) {
  diagnostics.push({ code, severity: 'fatal', path, message, publishBlocking: true })
  return inspection(null, diagnostics)
}

function inspection(
  loadedPackage: InspectedAgentPluginPackage | null,
  diagnostics: AgentPluginDiagnostic[],
  components: AgentPluginPackageInspection['components'] = { skills: [], mcpServers: [] },
): AgentPluginPackageInspection {
  const loadable = loadedPackage !== null
  const publishBlocking = diagnostics.some((diagnostic) => diagnostic.publishBlocking)
  const portableBlocking = diagnostics.some(
    (diagnostic) =>
      diagnostic.publishBlocking && !diagnostic.code.startsWith('extension.ai-agentrig.'),
  )
  return {
    package: loadedPackage,
    diagnostics,
    conformance: {
      loadable,
      portable: loadable && !portableBlocking,
      publishable: loadable && !publishBlocking,
    },
    components,
  }
}

function inspectSkills(
  sources: readonly AgentSkillSource[] | undefined,
  diagnostics: AgentPluginDiagnostic[],
) {
  if (!sources) return []
  const skills: AgentSkill[] = []
  for (const source of sources) {
    const result = validateAgentSkill(source)
    if (result.skill) {
      skills.push(result.skill)
      continue
    }
    diagnostics.push(...result.issues.map((message): AgentPluginDiagnostic => ({
      code: 'skill.invalid',
      severity: 'error',
      path: source.path,
      message,
      publishBlocking: true,
    })))
  }
  return skills.sort((left, right) => left.path.localeCompare(right.path))
}

function inspectMcp(
  source: AgentPluginPackageInput['mcp'],
  diagnostics: AgentPluginDiagnostic[],
) {
  if (!source) return []
  const inspection = inspectAgentPluginMcpDocument(source)
  diagnostics.push(...inspection.diagnostics)
  return inspection.servers
}

export function inspectAgentPluginMcpDocument(
  source: NonNullable<AgentPluginPackageInput['mcp']>,
): AgentPluginMcpInspection {
  const diagnostics: AgentPluginDiagnostic[] = []
  let raw: unknown
  try {
    raw = JSON.parse(source.content)
  } catch {
    diagnostics.push(componentDiagnostic('mcp.invalid-document', source.path, 'mcp.json must contain valid JSON.'))
    return { diagnostics, servers: [] }
  }
  const document = AgentPluginMcpDocumentSchema.safeParse(raw)
  if (!document.success) {
    diagnostics.push(componentDiagnostic(
      'mcp.invalid-document',
      source.path,
      document.error.issues.map((issue) => issue.message).join('; '),
    ))
    return { diagnostics, servers: [] }
  }
  if (document.data.$schema !== AGENT_PLUGIN_MCP_SCHEMA_URL) {
    diagnostics.push(componentDiagnostic('mcp.schema.unsupported', `${source.path}.$schema`, 'Unsupported MCP schema.'))
    return { diagnostics, servers: [] }
  }

  const servers: Array<{ name: string; server: AgentPluginMcpServer }> = []
  for (const [name, rawServer] of Object.entries(document.data.mcpServers)) {
    const server = AgentPluginMcpServerSchema.safeParse(rawServer)
    if (server.success) {
      servers.push({ name, server: server.data })
      continue
    }
    diagnostics.push(componentDiagnostic(
      'mcp.invalid-server',
      `${source.path}.mcpServers.${name}`,
      server.error.issues.map((issue) => issue.message).join('; '),
    ))
  }
  return { diagnostics, servers: servers.sort((left, right) => left.name.localeCompare(right.name)) }
}

function validateAgentRigSkillReferences(
  extension: AgentRigPluginExtension,
  skills: readonly AgentSkill[],
  diagnostics: AgentPluginDiagnostic[],
) {
  const names = new Set(skills.map((skill) => skill.frontmatter.name))
  const references = [
    ...(extension.publicSkills ?? []).map((name) => ({ field: 'publicSkills', name })),
    ...(extension.supportSkills ?? []).map((name) => ({ field: 'supportSkills', name })),
    ...Object.entries(extension.aliases ?? {}).map(([alias, name]) => ({ field: `aliases.${alias}`, name })),
  ]
  for (const reference of references) {
    if (names.has(reference.name)) continue
    diagnostics.push(componentDiagnostic(
      'extension.ai-agentrig.missing-skill',
      `extensions.${AGENTRIG_EXTENSION_NAMESPACE}.${reference.field}`,
      `Referenced skill "${reference.name}" does not exist as a valid skills/*/SKILL.md component.`,
    ))
  }
}

function componentDiagnostic(code: string, path: string, message: string): AgentPluginDiagnostic {
  return { code, severity: 'error', path, message, publishBlocking: true }
}

function zodDiagnostics(error: z.ZodError, unsupportedVersion: boolean): AgentPluginDiagnostic[] {
  return error.issues.map((issue) => ({
    code: unsupportedVersion && issue.path[0] === '$schema'
      ? 'manifest.schema.unsupported'
      : 'manifest.invalid',
    severity: 'fatal',
    path: issue.path.length ? issue.path.join('.') : 'plugin.json',
    message: issue.message,
    publishBlocking: true,
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
