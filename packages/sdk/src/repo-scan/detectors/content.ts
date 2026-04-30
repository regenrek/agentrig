import { z } from 'zod'
import type { Signal } from '../types'
import { normalizeVirtualPath, virtualBasename, virtualDirname } from '../virtual-tree'
import {
  createSignal,
  detectorRoots,
  filesForExact,
  filesForPrefix,
  idFromPath,
  relativePathFromRoot,
  slugifySignalId,
  titleFromPath,
  type DetectorInput,
} from './common'

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
type JsonValue = z.infer<typeof jsonPrimitiveSchema> | JsonValue[] | { [key: string]: JsonValue }
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]))
const mcpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional(),
  })
  .passthrough()
  .refine((server) => Boolean(server.command || server.url), 'MCP server must declare command or url')
const mcpConfigSchema = z
  .object({
    mcpServers: z.record(z.string(), mcpServerSchema).refine((servers) => Object.keys(servers).length > 0),
  })
  .passthrough()
const hookCommandSchema = z.object({ type: z.string(), command: z.string().optional() }).passthrough()
const hookMatcherSchema = z
  .object({
    matcher: z.string().optional(),
    hooks: z.array(hookCommandSchema).min(1),
  })
  .passthrough()
const hooksMapSchema = z.record(z.string(), z.array(hookMatcherSchema).min(1)).refine((hooks) => Object.keys(hooks).length > 0)
const hooksSchema = z.union([
  hooksMapSchema,
  z.object({ hooks: hooksMapSchema }).passthrough(),
])
const standaloneHookManifestSchema = z.object({
  kind: z.literal('agentrig:hook'),
}).passthrough()
const codexAppSchema = z
  .object({
    interface: z.unknown().optional(),
    entrypoint: z.string().optional(),
  })
  .passthrough()
  .refine((app) => Boolean(app.interface || app.entrypoint), 'Codex app must declare interface or entrypoint')
const lspServerSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
  .refine((server) => Boolean(server.command), 'LSP server must declare command')
const claudeLspSchema = z
  .object({
    languageServers: z.record(z.string(), lspServerSchema).refine((servers) => Object.keys(servers).length > 0),
  })
  .passthrough()
const knownSettingsKeys = new Set([
  'permissions',
  'env',
  'statusLine',
  'model',
  'includeCoAuthoredBy',
  'cleanupPeriodDays',
  'theme',
  'autoUpdate',
])
const providerSettingsSchema = z
  .record(z.string(), jsonValueSchema)
  .refine((settings) => Object.keys(settings).some((key) => knownSettingsKeys.has(key)), 'Settings must contain a known provider setting key')

type Frontmatter = {
  name?: string
  title?: string
  description?: string
}

export async function detectSkills(input: DetectorInput): Promise<Signal[]> {
  const signals: Signal[] = []
  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    if (virtualBasename(path) !== 'SKILL.md') continue

    const text = await input.tree.readText(path)
    const frontmatter = parseFrontmatter(text)
    if (!frontmatter?.name || !frontmatter.description) continue

    const sourcePath = virtualDirname(path)
    signals.push(
      createSignal({
        kind: 'skill',
        id: slugifySignalId(frontmatter.name),
        title: frontmatter.name,
        description: frontmatter.description,
        sourcePath,
        files: filesForPrefix(input.files, sourcePath),
        score: 1,
      })
    )
  }
  return signals
}

export async function detectAgents(input: DetectorInput): Promise<Signal[]> {
  const signals: Signal[] = []
  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    if (!isAgentDefinitionPath(path)) continue

    const frontmatter = parseFrontmatter(await input.tree.readText(path))
    if (!frontmatter?.name || !frontmatter.description) continue

    signals.push(
      createSignal({
        kind: 'agent',
        id: slugifySignalId(frontmatter.name),
        title: frontmatter.name,
        description: frontmatter.description,
        sourcePath: path,
        files: filesForExact(input.files, path),
        score: 1,
      })
    )
  }
  return signals
}

export async function detectCursorRules(input: DetectorInput): Promise<Signal[]> {
  const signals: Signal[] = []
  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    if (
      !rootRelativePaths(input, path).some(
        (relativePath) => relativePath.startsWith('.cursor/rules/') && relativePath.endsWith('.mdc')
      )
    ) {
      continue
    }

    const frontmatter = parseFrontmatter(await input.tree.readText(path))
    if (!frontmatter) continue

    signals.push(
      createSignal({
        kind: 'rule',
        id: idFromPath(path),
        title: frontmatter.title ?? frontmatter.name ?? titleFromPath(path),
        ...(frontmatter.description ? { description: frontmatter.description } : {}),
        sourcePath: path,
        files: filesForExact(input.files, path),
        score: 0.95,
      })
    )
  }
  return signals
}

export async function detectTypedCommands(input: DetectorInput): Promise<Signal[]> {
  const commandPrefixes = ['.claude/commands/', '.codex/prompts/', '.cursor/commands/']
  return input.files
    .map((file) => normalizeVirtualPath(file.path))
    .filter((path) =>
      path.endsWith('.md') &&
      rootRelativePaths(input, path).some((relativePath) =>
        commandPrefixes.some((prefix) => relativePath.startsWith(prefix))
      )
    )
    .map((path) =>
      createSignal({
        kind: 'command',
        id: idFromPath(path),
        title: titleFromPath(path),
        sourcePath: path,
        files: filesForExact(input.files, path),
        score: 0.9,
      })
    )
}

export function detectTopLevelPrompts(input: DetectorInput): Signal[] {
  return input.files
    .map((file) => normalizeVirtualPath(file.path))
    .filter((path) => {
      return rootRelativePaths(input, path).some((relativePath) => {
        const parts = relativePath.split('/')
        return parts.length === 2 && (parts[0] === 'prompts' || parts[0] === 'commands') && relativePath.endsWith('.md')
      })
    })
    .map((path) =>
      createSignal({
        kind: 'prompt',
        id: idFromPath(path),
        title: titleFromPath(path),
        sourcePath: path,
        files: filesForExact(input.files, path),
        score: 0.75,
      })
    )
}

export async function detectJsonConfigs(input: DetectorInput): Promise<Signal[]> {
  const signals: Signal[] = []
  for (const file of input.files) {
    const path = normalizeVirtualPath(file.path)
    const raw = await readJson(input, path)
    if (!raw) continue

    const relatives = rootRelativePaths(input, path)
    if (
      relatives.some((relativePath) => relativePath === '.mcp.json' || relativePath === 'mcp.json') &&
      mcpConfigSchema.safeParse(raw).success
    ) {
      signals.push(jsonSignal(input, path, 'mcp', 'MCP Servers', 1))
      continue
    }
    if (
      relatives.some(
        (relativePath) => relativePath === 'hooks.json' || relativePath === 'hooks/hooks.json' || relativePath.endsWith('/hooks.json')
      ) &&
      hooksSchema.safeParse(raw).success
    ) {
      signals.push(jsonSignal(input, path, 'hook', 'Hooks', 1))
      continue
    }
    if (
      relatives.some((relativePath) => relativePath === '.hook/hook.json' || relativePath.endsWith('/.hook/hook.json')) &&
      standaloneHookManifestSchema.safeParse(raw).success
    ) {
      signals.push(jsonSignal(input, path, 'hook', 'Hook Manifest', 1))
      continue
    }
    if (relatives.some((relativePath) => relativePath === '.lsp.json') && claudeLspSchema.safeParse(raw).success) {
      signals.push(jsonSignal(input, path, 'lsp', 'Claude LSP', 0.9))
      continue
    }
    if (relatives.some((relativePath) => relativePath === '.app.json') && codexAppSchema.safeParse(raw).success) {
      signals.push(jsonSignal(input, path, 'codex-app', 'Codex App', 1))
      continue
    }
    if (
      relatives.some((relativePath) => relativePath === 'settings.json') &&
      providerSettingsSchema.safeParse(raw).success
    ) {
      signals.push(jsonSignal(input, path, 'settings', 'Settings', 0.8))
    }
  }
  return signals
}

function jsonSignal(input: DetectorInput, path: string, kind: Signal['kind'], title: string, score: number) {
  return createSignal({
    kind,
    id: kind === 'hook' ? 'hooks' : idFromPath(path),
    title,
    sourcePath: path,
    files: filesForExact(input.files, path),
    score,
  })
}

async function readJson(input: DetectorInput, path: string) {
  if (!path.endsWith('.json')) return undefined
  const text = await input.tree.readText(path)
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function parseFrontmatter(text: string | null): Frontmatter | undefined {
  const normalizedText = text?.replace(/\r\n/g, '\n')
  if (!normalizedText?.startsWith('---\n')) return undefined
  const end = normalizedText.indexOf('\n---', 4)
  if (end === -1) return undefined

  const fields: Frontmatter = {}
  for (const line of normalizedText.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1] as keyof Frontmatter
    if (key !== 'name' && key !== 'title' && key !== 'description') continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (value) fields[key] = value
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

function isAgentDefinitionPath(path: string) {
  if (!path.endsWith('.md') && !path.endsWith('.mdx')) return false

  const parts = path.split('/')
  const agentsIndex = parts.findIndex((part) => part === 'agents')
  if (agentsIndex === -1) return false

  const afterAgents = parts.slice(agentsIndex + 1)
  if (parts[agentsIndex - 1] === '.claude') return afterAgents.length === 1
  return afterAgents.length === 1 || afterAgents.length === 2
}

function rootRelativePaths(input: DetectorInput, path: string, roots = detectorRoots(input)) {
  return roots
    .map((root) => relativePathFromRoot(path, root))
    .filter((relativePath): relativePath is string => relativePath !== null && relativePath.length > 0)
}
