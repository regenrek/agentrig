import { z } from 'zod'
import type { SelectableArtifactKind } from './artifact-kinds'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ARTIFACT_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const baseManifest = z.object({
  $schema: z.string().trim().min(1).optional(),
  id: z.string().trim().max(64).regex(ARTIFACT_ID_RE),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  version: z.string().trim().max(64).regex(SEMVER_RE),
  author: z.string().trim().min(1).optional(),
  license: z.string().trim().min(1).optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  capability_set: z.array(z.string().trim().min(1)).optional(),
  declared_network_domains: z.array(z.string().trim().min(1)).optional(),
  declared_secrets: z.array(z.string().trim().min(1)).optional(),
  runtime_requirements: z.array(z.string().trim().min(1)).optional(),
}).strict()

export const skillManifestSchema = baseManifest.extend({
  kind: z.literal('agentrig:skill'),
  entry: z.string().trim().min(1).default('SKILL.md'),
})

export const mcpManifestSchema = baseManifest.extend({
  kind: z.literal('agentrig:mcp'),
  config: z.string().trim().min(1).default('mcp.json'),
})

export const hookManifestSchema = baseManifest.extend({
  kind: z.literal('agentrig:hook'),
  config: z.string().trim().min(1).default('hooks/hooks.json'),
})

export const standaloneArtifactManifestSchema = z.discriminatedUnion('kind', [
  skillManifestSchema,
  mcpManifestSchema,
  hookManifestSchema,
])

export type SkillManifest = z.infer<typeof skillManifestSchema>
export type McpManifest = z.infer<typeof mcpManifestSchema>
export type HookManifest = z.infer<typeof hookManifestSchema>
export type StandaloneArtifactManifest = z.infer<typeof standaloneArtifactManifestSchema>

export function artifactKindFromStandaloneManifest(manifest: StandaloneArtifactManifest): SelectableArtifactKind {
  if (manifest.kind === 'agentrig:skill') return 'skill'
  if (manifest.kind === 'agentrig:mcp') return 'mcp'
  return 'hook'
}

export function parseStandaloneArtifactManifest(raw: unknown): StandaloneArtifactManifest {
  return standaloneArtifactManifestSchema.parse(raw)
}
