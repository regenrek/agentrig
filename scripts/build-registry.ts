\
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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
  rigDependencies?: string[]
  files: PackFile[]
}

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

async function pathExists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destPath), { recursive: true })
      await fs.copyFile(srcPath, destPath)
    }
  }
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

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')

  const packsRoot = path.join(repoRoot, 'registry', 'packs')
  const webPublicRegistryRoot = path.join(repoRoot, 'apps', 'web', 'public', 'registry')
  const webPublicRegistryPacks = path.join(webPublicRegistryRoot, 'packs')

  if (!(await pathExists(packsRoot))) {
    throw new Error(`Missing packs directory: ${packsRoot}`)
  }

  // clean output
  await fs.rm(webPublicRegistryRoot, { recursive: true, force: true })
  await fs.mkdir(webPublicRegistryPacks, { recursive: true })

  const packDirs = (await fs.readdir(packsRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(packsRoot, e.name))

  const items: Array<{
    name: string
    title: string
    description: string
    version: string
    tags?: string[]
    meta: string
  }> = []

  for (const packDir of packDirs) {
    const metaPath = path.join(packDir, 'meta.json')
    if (!(await pathExists(metaPath))) continue

    const raw = await fs.readFile(metaPath, 'utf-8')
    const meta = JSON.parse(raw)
    assertPackMeta(meta, packDir)

    const packName = meta.name
    const outPackDir = path.join(webPublicRegistryPacks, packName)

    // Copy pack files (excluding meta.json) into web public
    await fs.mkdir(outPackDir, { recursive: true })
    const entries = await fs.readdir(packDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'meta.json') continue
      const src = path.join(packDir, entry.name)
      const dest = path.join(outPackDir, entry.name)
      if (entry.isDirectory()) {
        await copyDir(src, dest)
      } else if (entry.isFile()) {
        await fs.copyFile(src, dest)
      }
    }

    // Build compiled registry item json
    const compiled: PackMeta = {
      ...meta,
      kind: meta.kind ?? 'agentrig:pack',
      files: [],
    }

    for (const f of meta.files) {
      const srcFileOnDisk = path.join(packDir, f.path)
      if (!(await pathExists(srcFileOnDisk))) {
        throw new Error(`Pack "${packName}" references missing file: ${srcFileOnDisk}`)
      }
      const buf = await fs.readFile(srcFileOnDisk)

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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
