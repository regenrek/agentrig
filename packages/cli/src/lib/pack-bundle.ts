import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { ensureDir, pathExists, removeIfExists, writeTextFile } from './fs'
import { validatePackMeta } from './pack-validation'
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

async function readRegularFile(filePath: string) {
  const stat = await fs.lstat(filePath)
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in publish bundles: ${filePath}`)
  }
  if (!stat.isFile()) {
    throw new Error(`Expected a file but found something else: ${filePath}`)
  }
  return await fs.readFile(filePath)
}

async function readMetaFile(dir: string, policy: PackUploadPolicySnapshot) {
  const metaPath = path.join(dir, 'meta.json')
  if (!(await pathExists(metaPath))) {
    throw new Error(`meta.json not found in ${dir}`)
  }
  const metaRaw = await fs.readFile(metaPath, 'utf-8')
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
  const directory = path.resolve(options.dir)
  const { meta, metaRaw } = await readMetaFile(directory, options.policy)
  const zip = new JSZip()

  zip.file('meta.json', metaRaw.endsWith('\n') ? metaRaw : `${metaRaw}\n`)

  for (const entry of meta.files) {
    const absolutePath = path.join(directory, entry.path)
    const bytes = await readRegularFile(absolutePath)
    zip.file(entry.path, bytes, {
      unixPermissions: entry.mode ? Number.parseInt(entry.mode, 8) : undefined,
    })
  }

  const readmePath = path.join(directory, 'README.md')
  if (await pathExists(readmePath)) {
    const readmeBytes = await readRegularFile(readmePath)
    zip.file('README.md', readmeBytes)
  }

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })

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
