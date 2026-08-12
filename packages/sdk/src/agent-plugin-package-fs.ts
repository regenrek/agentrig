import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  inspectAgentPluginPackage,
  type AgentPluginDiagnostic,
  type AgentPluginPackageInspection,
} from './agent-plugin-package'
import type { AgentSkillSource } from './agent-skills'

type ContainedPathKind = 'file' | 'directory'

class PackagePathError extends Error {
  readonly code: 'filesystem.path-escape' | 'filesystem.unreadable' | 'filesystem.wrong-kind'

  constructor(code: PackagePathError['code'], message: string) {
    super(message)
    this.name = 'PackagePathError'
    this.code = code
  }
}

export async function inspectAgentPluginPackageDirectory(
  packageRoot: string,
): Promise<AgentPluginPackageInspection> {
  let root: string
  try {
    const requestedRoot = path.resolve(packageRoot)
    await fs.lstat(requestedRoot)
    root = await fs.realpath(requestedRoot)
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) throw new Error('Package root is not a directory.')
  } catch (error) {
    return fatalFilesystemInspection('filesystem.invalid-root', packageRoot, errorMessage(error))
  }

  const manifestRead = await readContainedText(root, 'plugin.json', false)
  if (manifestRead.content === undefined) {
    return fatalFilesystemInspection(
      manifestRead.diagnostic?.code ?? 'filesystem.unreadable',
      'plugin.json',
      manifestRead.diagnostic?.message ?? 'plugin.json could not be read.',
    )
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(manifestRead.content)
  } catch (error) {
    return fatalFilesystemInspection('manifest.invalid-json', 'plugin.json', errorMessage(error))
  }

  const filesystemDiagnostics: AgentPluginDiagnostic[] = []
  const skills = await readSkills(root, filesystemDiagnostics)
  const mcpRead = await readContainedText(root, 'mcp.json', true)
  if (mcpRead.diagnostic) filesystemDiagnostics.push(mcpRead.diagnostic)

  const inspected = inspectAgentPluginPackage({
    manifest,
    skills,
    ...(mcpRead.content !== undefined ? { mcp: { path: 'mcp.json', content: mcpRead.content } } : {}),
  })
  return appendDiagnostics(inspected, filesystemDiagnostics)
}

async function readSkills(root: string, diagnostics: AgentPluginDiagnostic[]): Promise<AgentSkillSource[]> {
  let skillsRoot: string | undefined
  try {
    skillsRoot = await resolveContainedPath(root, 'skills', 'directory', true)
  } catch (error) {
    diagnostics.push(filesystemDiagnostic(error, 'skills'))
    return []
  }
  if (!skillsRoot) return []

  let entries
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch (error) {
    diagnostics.push(componentFilesystemDiagnostic('filesystem.unreadable', 'skills', errorMessage(error)))
    return []
  }

  const sources: AgentSkillSource[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const relativePath = `skills/${entry.name}/SKILL.md`
    const read = await readContainedText(root, relativePath, true)
    if (read.diagnostic) {
      diagnostics.push(read.diagnostic)
      continue
    }
    if (read.content !== undefined) sources.push({ path: relativePath, content: read.content })
  }
  return sources
}

async function readContainedText(root: string, relativePath: string, optional: boolean) {
  try {
    const resolved = await resolveContainedPath(root, relativePath, 'file', optional)
    if (!resolved) return { content: undefined }
    return { content: await fs.readFile(resolved, 'utf-8') }
  } catch (error) {
    return { content: undefined, diagnostic: filesystemDiagnostic(error, relativePath) }
  }
}

async function resolveContainedPath(
  root: string,
  relativePath: string,
  kind: ContainedPathKind,
  optional: boolean,
): Promise<string | undefined> {
  const candidate = path.resolve(root, relativePath)
  if (!isInside(root, candidate)) {
    throw new PackagePathError('filesystem.path-escape', `Path escapes plugin root: ${relativePath}`)
  }

  try {
    await fs.lstat(candidate)
  } catch (error) {
    if (optional && isMissing(error)) return undefined
    throw new PackagePathError('filesystem.unreadable', errorMessage(error))
  }

  let resolved: string
  try {
    resolved = await fs.realpath(candidate)
  } catch (error) {
    throw new PackagePathError('filesystem.unreadable', errorMessage(error))
  }
  if (!isInside(root, resolved)) {
    throw new PackagePathError(
      'filesystem.path-escape',
      `Resolved path escapes plugin root: ${relativePath}`,
    )
  }

  const stat = await fs.stat(resolved)
  const correctKind = kind === 'file' ? stat.isFile() : stat.isDirectory()
  if (!correctKind) {
    throw new PackagePathError('filesystem.wrong-kind', `Expected ${relativePath} to be a ${kind}.`)
  }
  return resolved
}

function appendDiagnostics(
  inspection: AgentPluginPackageInspection,
  additional: AgentPluginDiagnostic[],
): AgentPluginPackageInspection {
  if (!additional.length) return inspection
  const diagnostics = [...additional, ...inspection.diagnostics]
  return {
    ...inspection,
    diagnostics,
    conformance: {
      ...inspection.conformance,
      portable: false,
      publishable: false,
    },
  }
}

function fatalFilesystemInspection(code: string, pathName: string, message: string): AgentPluginPackageInspection {
  return {
    package: null,
    diagnostics: [{ code, severity: 'fatal', path: pathName, message, publishBlocking: true }],
    conformance: { loadable: false, portable: false, publishable: false },
    components: { skills: [], mcpServers: [] },
  }
}

function filesystemDiagnostic(error: unknown, pathName: string): AgentPluginDiagnostic {
  const code = error instanceof PackagePathError ? error.code : 'filesystem.unreadable'
  return componentFilesystemDiagnostic(code, pathName, errorMessage(error))
}

function componentFilesystemDiagnostic(code: string, pathName: string, message: string): AgentPluginDiagnostic {
  return { code, severity: 'error', path: pathName, message, publishBlocking: true }
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isMissing(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
