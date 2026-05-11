import { describe, expect, it } from 'vite-plus/test'
import {
  buildEnrichmentPrompt,
  validateEnrichmentDraft,
} from '../../src/enrich/contract'

describe('AiEnrichmentDraft contract', () => {
  it('normalizes safe draft fields', () => {
    expect(
      validateEnrichmentDraft({
        description: 'Reusable TypeScript review workflow.',
        keywords: ['TypeScript', 'review', 'review'],
        suggestedPluginId: 'Community.TypeScript-Review',
      })
    ).toEqual({
      ok: true,
      draft: {
        description: 'Reusable TypeScript review workflow.',
        keywords: ['typescript', 'review'],
        suggestedPluginId: 'community.typescript-review',
      },
    })
  })

  it('normalizes null optional fields out of otherwise valid drafts', () => {
    expect(
      validateEnrichmentDraft({
        description: null,
        keywords: ['Review'],
        suggestedPluginId: null,
      })
    ).toEqual({
      ok: true,
      draft: {
        keywords: ['review'],
      },
    })
  })

  it('rejects unsafe or non-canonical draft fields', () => {
    expect(validateEnrichmentDraft({ description: '[click](https://example.com)' })).toMatchObject({ ok: false })
    expect(validateEnrichmentDraft({ keywords: ['free'] })).toMatchObject({ ok: false })
    expect(validateEnrichmentDraft({ suggestedPluginId: 'not..plugin' })).toMatchObject({ ok: false })
    expect(validateEnrichmentDraft({})).toEqual({
      ok: false,
      reason: 'Enrichment draft must include at least one field',
    })
  })

  it('builds a versioned prompt from bounded evidence', () => {
    const signals = Array.from({ length: 205 }, (_, index) => ({
      kind: 'skill' as const,
      id: `typescript-${index}`,
      title: `TypeScript ${index}`,
      sourcePath: `skills/typescript-${index}/SKILL.md`,
      providerCompat: {
        claude: 'native' as const,
        codex: 'native' as const,
        cursor: 'port' as const,
      },
    }))

    const prompt = buildEnrichmentPrompt({
      repoName: 'owner/repo',
      topLevelPaths: ['skills', 'README.md'],
      fieldsToFill: ['description', 'keywords'],
      readmeExcerpt: 'A'.repeat(4100),
      signals,
    })

    expect(prompt.promptVersion).toBe('enrich-v1')
    expect(prompt.system).toContain('Return only JSON')
    expect(prompt.system).toContain('lowercase slug tokens')
    expect(prompt.user).toContain('"repoName": "owner/repo"')
    expect(prompt.user).toContain('"fieldsToFill"')
    expect(prompt.user).not.toContain('A'.repeat(4100))
    expect(prompt.user).toContain('"id": "typescript-199"')
    expect(prompt.user).not.toContain('"id": "typescript-200"')
  })
})
