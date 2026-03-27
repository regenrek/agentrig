import JSZip from 'jszip'
import {
  isAllowedExtension,
  isAllowedFilename,
  isBlockedExtension,
  isProbablyBinary,
  isSafeRelativePath,
  validatePackMeta,
} from './pack-validation'
import type { PackMeta, PackPublishValidationResult, PackUploadPolicySnapshot } from './types'

type ZipEntry = JSZip.JSZipObject

export class PackPublishValidationError extends Error {
  readonly errors: string[]
  readonly warnings: string[]

  constructor(errors: string[], warnings: string[] = []) {
    super(errors[0] ?? 'Pack bundle validation failed')
    this.name = 'PackPublishValidationError'
    this.errors = errors
    this.warnings = warnings
  }
}

function getUncompressedSize(entry: ZipEntry) {
  const data = (entry as { _data?: { uncompressedSize?: number; _uncompressedSize?: number } })._data
  if (typeof data?.uncompressedSize === 'number') return data.uncompressedSize
  if (typeof data?._uncompressedSize === 'number') return data._uncompressedSize
  return null
}

function buildEntryIndex(entries: ZipEntry[]) {
  return new Map(entries.map((entry) => [entry.name, entry]))
}

function validateArchiveEntries(entries: ZipEntry[], policy: PackUploadPolicySnapshot) {
  const errors: string[] = []
  let totalBytes = 0

  if (entries.length > policy.maxFiles) {
    errors.push('Archive contains too many files')
  }

  for (const entry of entries) {
    if (!isSafeRelativePath(entry.name)) {
      errors.push(`Unsafe path detected: ${entry.name}`)
      continue
    }
    if (isBlockedExtension(entry.name, policy)) {
      errors.push(`Blocked file type: ${entry.name}`)
      continue
    }

    const uncompressed = getUncompressedSize(entry)
    if (uncompressed == null) {
      errors.push(`Unable to verify size for ${entry.name}`)
      continue
    }

    totalBytes += uncompressed
    if (uncompressed > policy.maxFileBytes) {
      errors.push(`File too large: ${entry.name}`)
    }
    if (totalBytes > policy.maxTotalBytes) {
      errors.push('Total unpacked size exceeds limit')
      break
    }
  }

  return { errors, totalBytes }
}

async function validatePackMetaAgainstArchive(
  meta: PackMeta,
  entryIndex: Map<string, ZipEntry>,
  entries: ZipEntry[],
  policy: PackUploadPolicySnapshot
) {
  const errors: string[] = []
  const warnings: string[] = []

  const extraFiles = entries
    .map((entry) => entry.name)
    .filter((name) => name !== 'meta.json' && name !== 'README.md')
    .filter((name) => !meta.files.some((file) => file.path === name))

  if (extraFiles.length) {
    warnings.push(`Archive contains ${extraFiles.length} extra file(s)`)
  }

  for (const fileRef of meta.files) {
    const entry = entryIndex.get(fileRef.path)
    if (!entry) {
      errors.push(`Missing file referenced in meta.json: ${fileRef.path}`)
      continue
    }
    if (!isAllowedExtension(fileRef.path, policy) && !isAllowedFilename(fileRef.path, policy)) {
      errors.push(`Disallowed file extension: ${fileRef.path}`)
      continue
    }

    const size = getUncompressedSize(entry)
    if (size == null) {
      errors.push(`Unable to verify size for ${fileRef.path}`)
      continue
    }
    if (size > policy.maxFileBytes) {
      errors.push(`File too large: ${fileRef.path}`)
      continue
    }

    const bytes = await entry.async('uint8array')
    if (
      isProbablyBinary(bytes) &&
      !isAllowedExtension(fileRef.path, policy) &&
      !isAllowedFilename(fileRef.path, policy)
    ) {
      errors.push(`Binary file not allowed: ${fileRef.path}`)
    }
  }

  return { errors, warnings }
}

export async function validatePackBundle(
  zipBytes: Uint8Array,
  policy: PackUploadPolicySnapshot
): Promise<PackPublishValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  if (zipBytes.length > policy.maxZipBytes) {
    errors.push('Upload exceeds size limit')
  }

  const zip = await JSZip.loadAsync(zipBytes)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  const entryIndex = buildEntryIndex(entries)

  const metaEntry = zip.file('meta.json')
  if (!metaEntry) {
    errors.push('meta.json is required at the archive root')
  }

  const readmeEntry = zip.file('README.md')
  if (!readmeEntry) {
    warnings.push('README.md is missing')
  }

  const archiveValidation = validateArchiveEntries(entries, policy)
  errors.push(...archiveValidation.errors)

  let meta: PackMeta | null = null
  if (metaEntry) {
    try {
      const raw = await metaEntry.async('string')
      meta = validatePackMeta(JSON.parse(raw), policy)
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : 'Failed to parse meta.json'
      )
    }
  }

  if (meta) {
    const metaValidation = await validatePackMetaAgainstArchive(meta, entryIndex, entries, policy)
    errors.push(...metaValidation.errors)
    warnings.push(...metaValidation.warnings)
  }

  if (errors.length || !meta) {
    throw new PackPublishValidationError(errors, warnings)
  }

  return {
    meta,
    fileCount: entries.length,
    totalBytes: archiveValidation.totalBytes,
    zipBytes: zipBytes.length,
    warnings,
  }
}

export function formatPackValidationMessages(messages: string[]) {
  return messages.map((message) => `- ${message}`).join('\n')
}
