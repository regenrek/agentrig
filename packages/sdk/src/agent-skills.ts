import { parseDocument } from 'yaml'
import { z } from 'zod'

const AGENT_SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export const AgentSkillFrontmatterSchema = z
  .object({
    name: z.string().min(1).max(64).regex(
      AGENT_SKILL_NAME_RE,
      'Skill name must contain lowercase letters, numbers, and single hyphens, and must start and end alphanumeric.',
    ).refine((name) => !name.includes('--'), 'Skill name must not contain consecutive hyphens.'),
    description: z.string().min(1).max(1024),
    license: z.string().min(1).optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    'allowed-tools': z.string().min(1).optional(),
  })
  .passthrough()

export type AgentSkillFrontmatter = z.infer<typeof AgentSkillFrontmatterSchema>

export type AgentSkillSource = {
  path: string
  content: string
}

export type AgentSkill = AgentSkillSource & {
  directoryName: string
  frontmatter: AgentSkillFrontmatter
  body: string
}

export type AgentSkillValidation = {
  skill?: AgentSkill
  issues: string[]
}

export function validateAgentSkill(source: AgentSkillSource): AgentSkillValidation {
  const pathMatch = /^skills\/([^/]+)\/SKILL\.md$/.exec(source.path)
  if (!pathMatch) {
    return { issues: ['Skill path must match skills/<name>/SKILL.md at exactly one directory level.'] }
  }

  const normalized = source.content.replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { issues: ['SKILL.md must start with YAML frontmatter.'] }
  }
  const closingMarker = normalized.indexOf('\n---\n', 4)
  if (closingMarker === -1) {
    return { issues: ['SKILL.md YAML frontmatter must end with a standalone --- marker.'] }
  }

  const yamlText = normalized.slice(4, closingMarker)
  const document = parseDocument(yamlText, { uniqueKeys: true })
  if (document.errors.length) {
    return { issues: document.errors.map((error) => `Invalid YAML frontmatter: ${error.message}`) }
  }

  const parsed = AgentSkillFrontmatterSchema.safeParse(document.toJS({ maxAliasCount: 0 }))
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => {
        const field = issue.path.length ? `${issue.path.join('.')}: ` : ''
        return `${field}${issue.message}`
      }),
    }
  }

  const directoryName = pathMatch[1]
  if (parsed.data.name !== directoryName) {
    return { issues: [`Skill name "${parsed.data.name}" must match parent directory "${directoryName}".`] }
  }

  return {
    skill: {
      ...source,
      directoryName,
      frontmatter: parsed.data,
      body: normalized.slice(closingMarker + 5),
    },
    issues: [],
  }
}
