import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { ensureDir, pathExists, removeIfExists } from './fs'
import { isSafeRelativePath, validatePluginManifest } from './plugin-validation'
import type { PluginBundle, PluginManifest, PluginUploadPolicySnapshot } from './types'

const EXCLUDED_TOP_LEVEL_NAMES = new Set(['node_modules', 'dist', '.git'])

function bundleFileName(manifest: PluginManifest) {
  return manifest.version ? `${manifest.name}-${manifest.version}.zip` : `${manifest.name}.zip`
}

function resolveBundlePath(dir: string, fileName: string, outFile?: string, temporary = true) {
  if (outFile) {
    return path.isAbsolute(outFile) ? outFile : path.join(dir, outFile)
  }
  if (!temporary) {
    return path.join(dir, fileName)
  }
  return path.join(tmpdir(), `agentrig-plugin-${globalThis.crypto.randomUUID()}`, fileName)
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
    throw new Error(`Path escapes plugin directory: ${relativePath}`)
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

async function walkBundleFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (currentDir === rootDir && EXCLUDED_TOP_LEVEL_NAMES.has(entry.name)) continue
    const nextPath = path.join(currentDir, entry.name)
    const relativePath = path.relative(rootDir, nextPath).split(path.sep).join('/')
    if (entry.isDirectory()) {
      files.push(...(await walkBundleFiles(rootDir, nextPath)))
      continue
    }
    if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

async function readPluginManifestFile(dir: string, policy: PluginUploadPolicySnapshot) {
  const manifestPath = path.join(dir, '.plugin', 'plugin.json')
  if (!(await pathExists(manifestPath))) {
    throw new Error(`.plugin/plugin.json not found in ${dir}`)
  }
  const { absolutePath: safeManifestPath } = await resolveBundleInputFile(
    dir,
    '.plugin/plugin.json',
    '.plugin/plugin.json',
  )
  const manifestRaw = await fs.readFile(safeManifestPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestRaw)
  } catch (error) {
    throw new Error(
      `Failed to parse .plugin/plugin.json: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return {
    manifestPath,
    manifestRaw,
    manifest: validatePluginManifest(parsed, policy),
  }
}

export async function createPluginBundle(options: {
  dir: string
  policy: PluginUploadPolicySnapshot
  outFile?: string
  temporary?: boolean
}) {
  const directory = await fs.realpath(path.resolve(options.dir))
  const { manifest, manifestRaw } = await readPluginManifestFile(directory, options.policy)
  const zipWriter = new ZipWriter(new Uint8ArrayWriter(), {
    level: 9,
    useWebWorkers: false,
  })

  const bundleFiles = await walkBundleFiles(directory)
  const normalizedManifest = manifestRaw.endsWith('\n') ? manifestRaw : `${manifestRaw}\n`
  await zipWriter.add(
    '.plugin/plugin.json',
    new Uint8ArrayReader(new TextEncoder().encode(normalizedManifest)),
  )

  for (const relativeFile of bundleFiles) {
    if (relativeFile === '.plugin/plugin.json') continue
    if (relativeFile === '.plugin/install.json') continue
    const sourceFile = await resolveBundleInputFile(directory, relativeFile, 'plugin file path')
    const bytes = await fs.readFile(sourceFile.absolutePath)
    const fileStat = await fs.stat(sourceFile.absolutePath)
    await zipWriter.add(sourceFile.normalizedPath, new Uint8ArrayReader(bytes), {
      unixMode: (fileStat.mode & 0o111) !== 0 ? 0o755 : undefined,
    })
  }

  const zipBytes = await zipWriter.close()

  const fileName = bundleFileName(manifest)
  const temporary = options.temporary ?? !options.outFile
  const bundlePath = resolveBundlePath(directory, fileName, options.outFile, temporary)
  await ensureDir(path.dirname(bundlePath))
  await fs.writeFile(bundlePath, zipBytes)

  return {
    directory,
    bundlePath,
    fileName,
    manifest,
    zipBytes,
    temporary,
  } satisfies PluginBundle
}

export async function removePluginBundle(bundle: Pick<PluginBundle, 'bundlePath' | 'temporary'>) {
  if (!bundle.temporary) return
  await removeIfExists(bundle.bundlePath)
}
