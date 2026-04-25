import { z } from 'zod'
import type { Signal } from '../repo-scan/types'

export const ENRICHMENT_PROMPT_VERSION = 'enrich-v1' as const
export const AI_ENRICHMENT_DRAFT_SCHEMA_VERSION = 'ai-enrichment-draft-v1' as const
const MAX_PROMPT_TOP_LEVEL_PATHS = 80
const MAX_PROMPT_SIGNALS = 200
const MAX_README_EXCERPT_CHARS = 4000

const MARKDOWN_LINK_RE = /\[[^\]]+\]\([^)]+\)/
const PLUGIN_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const KEYWORD_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const SPAM_KEYWORDS = new Set(['best', 'free', 'top', 'download', 'hack', 'hacked', 'cracked'])

const rawAiEnrichmentDraftSchema = z
  .object({
    description: z.string().nullable().optional(),
    keywords: z.array(z.string()).nullable().optional(),
    suggestedPluginId: z.string().nullable().optional(),
  })
  .strict()

export type AiEnrichmentDraft = {
  description?: string
  keywords?: string[]
  suggestedPluginId?: string
}

export const aiEnrichmentDraftSchema: z.ZodType<AiEnrichmentDraft> = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !MARKDOWN_LINK_RE.test(value), 'Description must not contain markdown links')
      .optional(),
    keywords: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .refine((value) => KEYWORD_RE.test(value), 'Keyword must be lowercase letters, numbers, or hyphens')
          .refine((value) => !SPAM_KEYWORDS.has(value), 'Keyword is not evidence-bound')
      )
      .max(12)
      .optional(),
    suggestedPluginId: z
      .string()
      .trim()
      .toLowerCase()
      .refine((value) => PLUGIN_ID_RE.test(value), 'Suggested plugin id must be namespace.plugin')
      .optional(),
  })
  .strict()
  .transform((draft) => {
    const keywords = draft.keywords ? [...new Set(draft.keywords)] : undefined
    return {
      ...(draft.description ? { description: draft.description } : {}),
      ...(keywords?.length ? { keywords } : {}),
      ...(draft.suggestedPluginId ? { suggestedPluginId: draft.suggestedPluginId } : {}),
    }
  })

export type EnrichmentPromptSignal = Pick<
  Signal,
  'kind' | 'id' | 'title' | 'description' | 'sourcePath' | 'providerCompat'
>

export type EnrichmentPromptInput = {
  repoName: string
  topLevelPaths: string[]
  signals: EnrichmentPromptSignal[]
  declaredFields?: {
    description?: string
    keywords?: string[]
    pluginId?: string
  }
  readmeExcerpt?: string
  fieldsToFill: Array<keyof AiEnrichmentDraft>
}

export function validateEnrichmentDraft(raw: unknown): { ok: true; draft: AiEnrichmentDraft } | { ok: false; reason: string } {
  const rawParsed = rawAiEnrichmentDraftSchema.safeParse(raw)
  if (!rawParsed.success) {
    return { ok: false, reason: rawParsed.error.issues[0]?.message ?? 'Invalid enrichment draft' }
  }

  const normalizedRaw = {
    ...(rawParsed.data.description != null ? { description: rawParsed.data.description } : {}),
    ...(rawParsed.data.keywords != null ? { keywords: rawParsed.data.keywords } : {}),
    ...(rawParsed.data.suggestedPluginId != null ? { suggestedPluginId: rawParsed.data.suggestedPluginId } : {}),
  }
  const parsed = aiEnrichmentDraftSchema.safeParse(normalizedRaw)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'Invalid enrichment draft' }
  }

  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, reason: 'Enrichment draft must include at least one field' }
  }

  return { ok: true, draft: parsed.data }
}

export function buildEnrichmentPrompt(input: EnrichmentPromptInput) {
  const system = [
    'You fill missing AgentRig plugin metadata from deterministic evidence.',
    'Return only JSON matching: { "description"?: string, "keywords"?: string[], "suggestedPluginId"?: string }.',
    'Keywords must be lowercase slug tokens: letters, numbers, or hyphens only; no spaces, underscores, punctuation, marketing terms, or duplicates.',
    'suggestedPluginId must be namespace.plugin with lowercase letters, numbers, dots, and hyphens only.',
    'Do not invent capabilities. Do not include markdown links. Keep output draft-only and evidence-bound.',
  ].join(' ')

  const userPayload = {
    repoName: input.repoName,
    topLevelPaths: input.topLevelPaths.slice(0, MAX_PROMPT_TOP_LEVEL_PATHS),
    detectedSignals: input.signals.slice(0, MAX_PROMPT_SIGNALS).map((signal) => ({
      kind: signal.kind,
      id: signal.id,
      title: signal.title,
      ...(signal.description ? { description: signal.description } : {}),
      sourcePath: signal.sourcePath,
      providerCompat: signal.providerCompat,
    })),
    declaredFields: input.declaredFields ?? {},
    readmeExcerpt: input.readmeExcerpt?.slice(0, MAX_README_EXCERPT_CHARS),
    fieldsToFill: input.fieldsToFill,
  }

  return {
    system,
    user: JSON.stringify(userPayload, null, 2),
    promptVersion: ENRICHMENT_PROMPT_VERSION,
  }
}
