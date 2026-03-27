import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js'
import {
  isAllowedExtension,
  isAllowedFilename,
  isBlockedExtension,
  isProbablyBinary,
  isSafeRelativePath,
  validatePackMeta,
} from './pack-validation'
import type { PackMeta, PackPublishValidationResult, PackUploadPolicySnapshot } from './types'

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

function getUncompressedSize(entry: Entry) {
  return typeof entry.uncompressedSize === 'number' ? entry.uncompressedSize : null
}

function buildEntryIndex(entries: FileEntry[]) {
  return new Map(entries.map((entry) => [entry.filename, entry]))
}

function validateArchiveEntries(entries: FileEntry[], policy: PackUploadPolicySnapshot) {
  const errors: string[] = []
  let totalBytes = 0

  if (entries.length > policy.maxFiles) {
    errors.push('Archive contains too many files')
  }

  for (const entry of entries) {
    if (!isSafeRelativePath(entry.filename)) {
      errors.push(`Unsafe path detected: ${entry.filename}`)
      continue
    }
    if (isBlockedExtension(entry.filename, policy)) {
      errors.push(`Blocked file type: ${entry.filename}`)
      continue
    }

    const uncompressed = getUncompressedSize(entry)
    if (uncompressed == null) {
      errors.push(`Unable to verify size for ${entry.filename}`)
      continue
    }

    totalBytes += uncompressed
    if (uncompressed > policy.maxFileBytes) {
      errors.push(`File too large: ${entry.filename}`)
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
  entryIndex: Map<string, FileEntry>,
  entries: FileEntry[],
  policy: PackUploadPolicySnapshot
) {
  const errors: string[] = []
  const warnings: string[] = []

  const extraFiles = entries
    .map((entry) => entry.filename)
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

    const bytes = await entry.getData(new Uint8ArrayWriter(), { useWebWorkers: false })
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

  const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes), {
    useWebWorkers: false,
  })

  try {
    const allEntries = await zipReader.getEntries()
    const entries = allEntries.filter((entry): entry is FileEntry => !entry.directory)
    const entryIndex = buildEntryIndex(entries)

    const metaEntry = entryIndex.get('meta.json')
    if (!metaEntry) {
      errors.push('meta.json is required at the archive root')
    }

    const readmeEntry = entryIndex.get('README.md')
    if (!readmeEntry) {
      warnings.push('README.md is missing')
    }

    const archiveValidation = validateArchiveEntries(entries, policy)
    errors.push(...archiveValidation.errors)

    let meta: PackMeta | null = null
    if (metaEntry) {
      try {
        const rawBytes = await metaEntry.getData(new Uint8ArrayWriter(), { useWebWorkers: false })
        const raw = new TextDecoder().decode(rawBytes)
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
  } finally {
    await zipReader.close()
  }
}

export function formatPackValidationMessages(messages: string[]) {
  return messages.map((message) => `- ${message}`).join('\n')
}
