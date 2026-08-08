import { z } from 'zod'
import {
  AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
  AGENT_PLUGIN_MCP_SCHEMA_URL,
  AGENTRIG_EXTENSION_NAMESPACE,
  AgentPluginMcpConfigSchema,
} from '../agent-plugins'
import type { SignalKind } from '../repo-scan/types'
import { joinVirtualPath, normalizeVirtualPath, virtualBasename } from '../repo-scan/virtual-tree'
import { isValidPluginName } from './plugin-names'
import type { MaterializedPluginFile, MaterializedPluginManifestInput, MaterializePluginOptions } from './types'

const PLUGIN_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SIGNAL_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const manifestInputSchema = z
  .object({
    name: z.string().trim().refine(isValidPluginName),
    displayName: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1),
    version: z.string().trim().max(64).regex(PLUGIN_VERSION_RE),
    category: z.string().trim().min(1),
    author: z
      .object({
        name: z.string().trim().min(1),
        email: z.string().trim().min(1).optional(),
        url: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    license: z.string().trim().min(1).optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
    source: z
      .object({
        repoUrl: z.string().trim().min(1).optional(),
        owner: z.string().trim().min(1).optional(),
        repo: z.string().trim().min(1).optional(),
        ref: z.string().trim().min(1).optional(),
        commitSha: z.string().trim().min(1).optional(),
        subdir: z.string().trim().min(1).optional(),
        scanDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()

export async function materializePlugin(options: MaterializePluginOptions): Promise<MaterializedPluginFile[]> {
  const manifest = buildPluginManifest(options.manifest, options.pickedSignals.map((signal) => signal.sourcePath))
  const files = new Map<string, MaterializedPluginFile>()

  addMaterializedFile(files, 'plugin.json', encodeJson(manifest))
  for (const signal of options.pickedSignals) {
    for (const file of signal.files) {
      const destinationPath = destinationPathForSignalFile(signal.kind, signal.id, signal.sourcePath, file.path)
      const sourceBytes = await readVirtualFileBytes(options.tree, file.path)
      await assertFileDigest(file.path, sourceBytes, file.sha256)
      const outputBytes = signal.kind === 'mcp' ? materializeMcpConfig(sourceBytes, file.path) : sourceBytes
      addMaterializedFile(files, destinationPath, outputBytes, file.sha256)
    }
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function buildPluginManifest(input: MaterializedPluginManifestInput, pickedSignalPaths: string[]) {
  const parsed = manifestInputSchema.parse(input)
  return {
    $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    ...(parsed.author ? { author: parsed.author } : {}),
    ...(parsed.license ? { license: parsed.license } : {}),
    ...(parsed.keywords?.length ? { keywords: parsed.keywords } : {}),
    extensions: {
      [AGENTRIG_EXTENSION_NAMESPACE]: {
        displayName: parsed.displayName ?? parsed.name,
        kind: 'plugin',
        listing: {
          category: parsed.category,
        },
        configSchema: {},
        pluginDependencies: [],
        source: {
          kind: 'external-repo',
          ...parsed.source,
          pickedSignalPaths: [...new Set(pickedSignalPaths)].sort(),
        },
      },
    },
  }
}

export function destinationPathForSignalFile(kind: SignalKind, signalId: string, sourcePath: string, filePath: string) {
  const source = normalizeVirtualPath(sourcePath)
  const file = normalizeVirtualPath(filePath)
  const basename = virtualBasename(file)

  if (kind === 'skill') return joinVirtualPath('skills', safeSignalId(signalId), relativeWithin(source, file))
  if (kind === 'mcp') return 'mcp.json'
  if (kind === 'command' || kind === 'prompt') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'commands', basename)
  if (kind === 'rule') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'rules', basename)
  if (kind === 'hook') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'hooks', 'hooks.json')
  if (kind === 'lsp') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'lsp.json')
  if (kind === 'codex-app') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'app.json')
  if (kind === 'settings') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'settings.json')
  if (kind === 'agent') return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'agents', basename)
  return joinVirtualPath(AGENTRIG_EXTENSION_NAMESPACE, 'source', file)
}

function materializeMcpConfig(bytes: Uint8Array, sourcePath: string) {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`Invalid MCP JSON: ${normalizeVirtualPath(sourcePath)}`)
  }
  if (!isRecord(raw) || !isRecord(raw.mcpServers)) {
    throw new Error(`Invalid MCP configuration: ${normalizeVirtualPath(sourcePath)}`)
  }
  const mcpServers = Object.fromEntries(
    Object.entries(raw.mcpServers).map(([name, server]) => [name, normalizeMcpServer(server, name)]),
  )
  return encodeJson(AgentPluginMcpConfigSchema.parse({
    $schema: AGENT_PLUGIN_MCP_SCHEMA_URL,
    mcpServers,
  }))
}

function normalizeMcpServer(server: unknown, name: string) {
  if (!isRecord(server)) throw new Error(`Invalid MCP server ${name}`)
  if (typeof server.command === 'string') {
    return compactObject({
      type: 'stdio',
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    })
  }
  if (typeof server.url === 'string') {
    return compactObject({
      type: server.type === 'sse' ? 'sse' : 'streamable-http',
      url: server.url,
      headers: server.headers,
    })
  }
  throw new Error(`Invalid MCP server ${name}`)
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function relativeWithin(sourcePath: string, filePath: string) {
  if (filePath === sourcePath) return virtualBasename(filePath)
  const prefix = `${sourcePath}/`
  if (!filePath.startsWith(prefix)) {
    throw new Error(`Signal file ${filePath} is not under source path ${sourcePath}`)
  }
  return filePath.slice(prefix.length)
}

async function readVirtualFileBytes(tree: MaterializePluginOptions['tree'], path: string) {
  const normalizedPath = normalizeVirtualPath(path)
  const bytes = await tree.readBytes?.(normalizedPath)
  if (bytes) return bytes

  const text = await tree.readText(normalizedPath)
  if (text == null) {
    throw new Error(`Missing virtual file content: ${normalizedPath}`)
  }
  return new TextEncoder().encode(text)
}

function addMaterializedFile(files: Map<string, MaterializedPluginFile>, path: string, bytes: Uint8Array, expectedSha?: string) {
  const normalizedPath = normalizeVirtualPath(path)
  const existing = files.get(normalizedPath)
  if (existing) {
    if (byteEquals(existing.bytes, bytes)) return
    throw new Error(`Materialized path conflict: ${normalizedPath}${expectedSha ? ` (${expectedSha})` : ''}`)
  }
  files.set(normalizedPath, { path: normalizedPath, bytes })
}

function safeSignalId(signalId: string) {
  const normalizedId = signalId.trim().toLowerCase()
  if (!SIGNAL_ID_RE.test(normalizedId)) {
    throw new Error(`Invalid signal id for materialized path: ${signalId}`)
  }
  return normalizedId
}

async function assertFileDigest(path: string, bytes: Uint8Array, expectedSha: string) {
  const actualSha = await sha256Hex(bytes)
  if (actualSha !== expectedSha) {
    throw new Error(`Virtual file changed after scan: ${normalizeVirtualPath(path)}`)
  }
}

function encodeJson(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

function byteEquals(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

async function sha256Hex(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 digest requires Web Crypto support')
  }
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
