import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { z } from 'zod'
import {
  CLI_SUPPORTED_ARTIFACT_KINDS,
  CliSupportedKindSchema,
  isCliSupportedKind,
} from '@agentrig/sdk'
import { loadConfig } from '../lib/config'
import {
  canonicalInstallTokenFromSlug,
  resolveConfiguredRegistry,
  normalizeRegistryUrl,
} from '../lib/registry'

const SearchHitSchema = z.object({
  slug: z.string().trim().min(1),
  artifactId: z.string().trim().min(1).optional(),
  kind: CliSupportedKindSchema,
  origin: z.enum(['standalone', 'bundled']),
  displayName: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  score: z.number(),
})

const SearchResponseSchema = z.object({
  results: z.array(SearchHitSchema),
})

export type SearchHit = Omit<z.infer<typeof SearchHitSchema>, 'artifactId'> & {
  artifactId: string
}

const command = defineCommand({
  meta: {
    name: 'search',
    description: 'Search the AgentRig marketplace by name, description, or keywords.',
  },
  args: {
    query: {
      type: 'positional',
      description: 'Search query (matches name, description, keywords, source repo).',
      required: true,
    },
    cwd: {
      type: 'string',
      description: 'Working directory (defaults to current directory)',
    },
    registry: {
      type: 'string',
      description: 'Marketplace alias to search (defaults to "agentrig").',
    },
    kind: {
      type: 'string',
      description: 'Restrict to a single kind: plugin, skill, mcp, or hook.',
    },
    limit: {
      type: 'string',
      description: 'Max results (1-100, default 25).',
    },
    json: {
      type: 'boolean',
      description: 'Print the raw `{results}` JSON payload.',
      default: false,
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)
    const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd()
    const query = String(args.query ?? '').trim()
    if (!query) {
      throw new Error('Search query is required.')
    }
    const cfg = await loadConfig(cwd)
    const alias = String(args.registry || 'agentrig')
    const registry = resolveConfiguredRegistry(alias, cfg.registries)
    const url = new URL('/api/cli/search', normalizeRegistryUrl(registry.url))
    url.searchParams.set('q', query)
    const limit = parseLimit(args.limit)
    if (limit) url.searchParams.set('limit', String(limit))
    if (args.kind) {
      const kind = String(args.kind).trim().toLowerCase()
      if (!isCliSupportedKind(kind)) {
        throw new Error(`Invalid --kind "${args.kind}". Use ${CLI_SUPPORTED_ARTIFACT_KINDS.join(', ')}.`)
      }
      url.searchParams.set('kind', kind)
    }
    const response = await fetch(url.toString(), { headers: { accept: 'application/json' } })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Search failed (${response.status}): ${text || response.statusText}`)
    }
    const parsed = normalizeSearchResponse(
      SearchResponseSchema.parse(text.length ? JSON.parse(text) : { results: [] })
    )
    if (args.json) {
      console.log(JSON.stringify(parsed, null, 2))
      return
    }
    if (parsed.results.length === 0) {
      console.log('No results.')
      return
    }
    for (const hit of parsed.results) {
      console.log(formatSearchHit(hit))
    }
  },
})

function normalizeSearchResponse(response: z.infer<typeof SearchResponseSchema>): { results: SearchHit[] } {
  return {
    results: response.results.map((hit) => ({
      ...hit,
      artifactId: hit.artifactId ?? canonicalInstallTokenFromSlug(hit.slug),
    })),
  }
}

export function formatSearchHit(hit: SearchHit) {
  const version = hit.version ? `  v${hit.version}` : ''
  const kindTag = `[${hit.kind}]`
  const score = hit.score.toFixed(3)
  return `${hit.artifactId}${version}  ${kindTag}  ${hit.displayName}  (${score})`
}

function parseLimit(raw: unknown) {
  if (raw == null) return undefined
  const parsed = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(100, parsed)
}

export default command
