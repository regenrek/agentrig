import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

type PackFile = {
  path: string
  target: string
  mode?: string
  sha256?: string
}

type PackMeta = {
  $schema?: string
  name: string
  title: string
  description: string
  version: string
  kind?: string
  author?: string
  license?: string
  tags?: string[]
  topics?: Record<string, string[]>
  rigDependencies?: string[]
  files: PackFile[]
}

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

const PACK_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/

async function pathExists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function isSafeRelativePath(value: string) {
  if (!value) return false
  if (value.startsWith('/') || value.startsWith('\\\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized === '..' ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.startsWith('./') ||
    normalized.endsWith('/..') ||
    normalized.includes('/../')
  ) {
    return false
  }
  return true
}

function assertPackName(name: string, packDir: string) {
  if (!PACK_NAME_REGEX.test(name)) {
    throw new Error(`Invalid pack name in ${packDir}: ${name}`)
  }
}

function resolveSafePath(root: string, relativePath: string, label: string) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Invalid ${label}: ${relativePath}`)
  }
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path traversal blocked for ${label}: ${relativePath}`)
  }
  return resolvedPath
}

function assertPackMeta(meta: any, packDir: string): asserts meta is PackMeta {
  const where = `meta.json in ${packDir}`
  if (!meta || typeof meta !== 'object') throw new Error(`Invalid ${where}: not an object`)
  for (const key of ['name', 'title', 'description', 'version']) {
    if (typeof meta[key] !== 'string' || !meta[key]) throw new Error(`Invalid ${where}: missing ${key}`)
  }
  if (!Array.isArray(meta.files)) throw new Error(`Invalid ${where}: "files" must be an array`)
  for (const f of meta.files) {
    if (!f || typeof f !== 'object') throw new Error(`Invalid ${where}: file entry must be an object`)
    if (typeof f.path !== 'string' || !f.path) throw new Error(`Invalid ${where}: file.path required`)
    if (typeof f.target !== 'string' || !f.target) throw new Error(`Invalid ${where}: file.target required`)
  }
}

type BuildRegistryOptions = {
  repoRoot: string
  packsRoot?: string
  outputRoot?: string
}

function isSubpath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (!relative) return false
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function assertSafeOutputRoot(repoRoot: string, outputRoot: string) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const resolvedOutputRoot = path.resolve(outputRoot)
  const filesystemRoot = path.parse(resolvedOutputRoot).root
  if (resolvedOutputRoot === filesystemRoot) {
    throw new Error(`Refusing to delete filesystem root: ${resolvedOutputRoot}`)
  }

  const defaultOutputRoot = path.join(
    resolvedRepoRoot,
    'apps',
    'docs',
    'public',
    'registry',
  )
  if (resolvedOutputRoot === defaultOutputRoot) return

  const tmpRoot = path.resolve(os.tmpdir())
  if (isSubpath(tmpRoot, resolvedOutputRoot)) return

  throw new Error(
    `Unsafe outputRoot: ${resolvedOutputRoot}. Must be ${defaultOutputRoot} or within ${tmpRoot}`,
  )
}

async function assertNoSymlinkInRelativePath(
  root: string,
  relativePath: string,
  label: string,
) {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink blocked for ${label}: ${relativePath}`)
    }
  }
}

export async function buildRegistry({ repoRoot, packsRoot, outputRoot }: BuildRegistryOptions) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const resolvedPacksRoot = packsRoot
    ? path.resolve(packsRoot)
    : path.join(resolvedRepoRoot, 'registry', 'packs')
  const webPublicRegistryRoot = outputRoot
    ? path.resolve(outputRoot)
    : path.join(resolvedRepoRoot, 'apps', 'docs', 'public', 'registry')
  assertSafeOutputRoot(resolvedRepoRoot, webPublicRegistryRoot)
  const webPublicRegistryPacks = path.join(webPublicRegistryRoot, 'packs')

  if (!(await pathExists(resolvedPacksRoot))) {
    throw new Error(`Missing packs directory: ${resolvedPacksRoot}`)
  }

  // clean output
  await fs.rm(webPublicRegistryRoot, { recursive: true, force: true })
  await fs.mkdir(webPublicRegistryPacks, { recursive: true })

  const packDirs = (await fs.readdir(resolvedPacksRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(resolvedPacksRoot, e.name))

  const items: Array<{
    name: string
    title: string
    description: string
    version: string
    tags?: string[]
    topics?: Record<string, string[]>
    meta: string
  }> = []

  for (const packDir of packDirs) {
    const metaPath = path.join(packDir, 'meta.json')
    if (!(await pathExists(metaPath))) continue

    const raw = await fs.readFile(metaPath, 'utf-8')
    const meta = JSON.parse(raw)
    assertPackMeta(meta, packDir)

    const packName = meta.name
    assertPackName(packName, packDir)
    const outPackDir = path.join(webPublicRegistryPacks, packName)
    const readmePath = path.join(packDir, 'README.md')

    if (!(await pathExists(readmePath))) {
      throw new Error(`Missing README.md for pack "${packName}": ${readmePath}`)
    }

    await fs.mkdir(outPackDir, { recursive: true })
    await fs.copyFile(readmePath, path.join(outPackDir, 'README.md'))

    // Build compiled registry item json
    const compiled: PackMeta = {
      ...meta,
      kind: meta.kind ?? 'agentrig:pack',
      files: [],
    }

    for (const f of meta.files) {
      const srcFileOnDisk = resolveSafePath(packDir, f.path, `pack file path for ${packName}`)
      await assertNoSymlinkInRelativePath(packDir, f.path, `pack file path for ${packName}`)
      const srcStat = await fs.lstat(srcFileOnDisk).catch(() => null)
      if (!srcStat || !srcStat.isFile()) {
        throw new Error(`Pack "${packName}" references missing file: ${srcFileOnDisk}`)
      }
      const buf = await fs.readFile(srcFileOnDisk)
      const destFile = resolveSafePath(outPackDir, f.path, `output path for ${packName}`)
      await fs.mkdir(path.dirname(destFile), { recursive: true })
      await fs.copyFile(srcFileOnDisk, destFile)

      compiled.files.push({
        ...f,
        sha256: f.sha256 ?? sha256(buf),
        // rewrite path to the public registry path, so a consumer can fetch it from the registry base URL
        path: path.posix.join('packs', packName, f.path.split(path.sep).join('/')),
      })
    }

    const outItemPath = path.join(webPublicRegistryRoot, `${packName}.json`)
    await fs.writeFile(outItemPath, JSON.stringify(compiled, null, 2) + '\n', 'utf-8')

    items.push({
      name: packName,
      title: meta.title,
      description: meta.description,
      version: meta.version,
      tags: meta.tags,
      topics: meta.topics,
      meta: `${packName}.json`,
    })
  }

  const registryIndex = {
    $schema: 'https://agentrig.dev/schema/registry.json',
    name: 'agentrig',
    homepage: 'https://agentrig.dev',
    generatedAt: new Date().toISOString(),
    items,
  }

  await fs.writeFile(
    path.join(webPublicRegistryRoot, 'registry.json'),
    JSON.stringify(registryIndex, null, 2) + '\n',
    'utf-8',
  )

  console.log(`Built registry with ${items.length} pack(s)`)
  console.log(`Output: ${webPublicRegistryRoot}`)
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  await buildRegistry({ repoRoot })
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return import.meta.url === pathToFileURL(argv1).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
