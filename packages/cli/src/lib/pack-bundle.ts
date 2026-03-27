import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { ensureDir, pathExists, removeIfExists } from './fs'
import { isSafeRelativePath, validatePackMeta } from './pack-validation'
import type { PackBundle, PackMeta, PackUploadPolicySnapshot } from './types'

function bundleFileName(meta: PackMeta) {
  return `${meta.name}-${meta.version}.zip`
}

function resolveBundlePath(dir: string, fileName: string, outFile?: string, temporary = true) {
  if (outFile) {
    return path.isAbsolute(outFile) ? outFile : path.join(dir, outFile)
  }
  if (!temporary) {
    return path.join(dir, fileName)
  }
  return path.join(tmpdir(), `agentrig-pack-${globalThis.crypto.randomUUID()}`, fileName)
}

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveBundleInputFile(rootDir: string, relativePath: string, label: string) {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  if (!isSafeRelativePath(normalizedPath)) {
    throw new Error(`Invalid ${label}: ${relativePath}`)
  }

  const segments = normalizedPath.split('/').filter(Boolean)
  let currentPath = rootDir
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment)
    const stat = await fs.lstat(currentPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in publish bundles: ${relativePath}`)
    }
  }

  const realPath = await fs.realpath(currentPath)
  if (!isPathInside(rootDir, realPath)) {
    throw new Error(`Path escapes pack directory: ${relativePath}`)
  }

  const stat = await fs.stat(realPath)
  if (!stat.isFile()) {
    throw new Error(`Expected a file but found something else: ${relativePath}`)
  }

  return {
    absolutePath: currentPath,
    normalizedPath,
  }
}

async function readMetaFile(dir: string, policy: PackUploadPolicySnapshot) {
  const metaPath = path.join(dir, 'meta.json')
  if (!(await pathExists(metaPath))) {
    throw new Error(`meta.json not found in ${dir}`)
  }
  const { absolutePath: safeMetaPath } = await resolveBundleInputFile(dir, 'meta.json', 'meta.json')
  const metaRaw = await fs.readFile(safeMetaPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(metaRaw)
  } catch (error) {
    throw new Error(
      `Failed to parse meta.json: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return {
    metaPath,
    metaRaw,
    meta: validatePackMeta(parsed, policy),
  }
}

export async function createPackBundle(options: {
  dir: string
  policy: PackUploadPolicySnapshot
  outFile?: string
  temporary?: boolean
}) {
  const directory = await fs.realpath(path.resolve(options.dir))
  const { meta, metaRaw } = await readMetaFile(directory, options.policy)
  const zipWriter = new ZipWriter(new Uint8ArrayWriter(), {
    level: 9,
    useWebWorkers: false,
  })

  const normalizedMeta = metaRaw.endsWith('\n') ? metaRaw : `${metaRaw}\n`
  await zipWriter.add('meta.json', new Uint8ArrayReader(new TextEncoder().encode(normalizedMeta)))

  for (const entry of meta.files) {
    const sourceFile = await resolveBundleInputFile(directory, entry.path, 'pack file path')
    const bytes = await fs.readFile(sourceFile.absolutePath)
    await zipWriter.add(sourceFile.normalizedPath, new Uint8ArrayReader(bytes), {
      unixMode: entry.mode ? Number.parseInt(entry.mode, 8) : undefined,
    })
  }

  const readmePath = path.join(directory, 'README.md')
  if (await pathExists(readmePath)) {
    const { absolutePath: safeReadmePath } = await resolveBundleInputFile(directory, 'README.md', 'README.md')
    const readmeBytes = await fs.readFile(safeReadmePath)
    await zipWriter.add('README.md', new Uint8ArrayReader(readmeBytes))
  }

  const zipBytes = await zipWriter.close()

  const fileName = bundleFileName(meta)
  const temporary = options.temporary ?? !options.outFile
  const bundlePath = resolveBundlePath(directory, fileName, options.outFile, temporary)
  await ensureDir(path.dirname(bundlePath))
  await fs.writeFile(bundlePath, zipBytes)

  return {
    directory,
    bundlePath,
    fileName,
    meta,
    zipBytes,
    temporary,
  } satisfies PackBundle
}

export async function removePackBundle(bundle: Pick<PackBundle, 'bundlePath' | 'temporary'>) {
  if (!bundle.temporary) return
  await removeIfExists(bundle.bundlePath)
}
