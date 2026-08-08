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
  validatePluginManifest,
} from './plugin-validation'
import type {
  PluginManifest,
  PluginSubmissionValidationResult,
  PluginUploadPolicySnapshot,
} from './types'

export class PluginSubmissionValidationError extends Error {
  readonly errors: string[]
  readonly warnings: string[]

  constructor(errors: string[], warnings: string[] = []) {
    super(errors[0] ?? 'Plugin bundle validation failed')
    this.name = 'PluginSubmissionValidationError'
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

function validateArchiveEntries(entries: FileEntry[], policy: PluginUploadPolicySnapshot) {
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

export async function validatePluginBundle(
  zipBytes: Uint8Array,
  policy: PluginUploadPolicySnapshot
): Promise<PluginSubmissionValidationResult> {
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

    const manifestEntry = entryIndex.get('plugin.json')
    if (!manifestEntry) {
      errors.push('plugin.json is required in the archive')
    }

    const readmeEntry = entryIndex.get('README.md')
    if (!readmeEntry) {
      warnings.push('README.md is missing')
    }

    const archiveValidation = validateArchiveEntries(entries, policy)
    errors.push(...archiveValidation.errors)

    let manifest: PluginManifest | null = null
    if (manifestEntry) {
      try {
        const rawBytes = await manifestEntry.getData(new Uint8ArrayWriter(), { useWebWorkers: false })
        const raw = new TextDecoder().decode(rawBytes)
        manifest = validatePluginManifest(JSON.parse(raw), policy)
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : 'Failed to parse plugin.json'
        )
      }
    }

    for (const entry of entries) {
      if (entry.filename === 'plugin.json') continue
      if (entry.filename === 'ai.agentrig/install.json') {
        errors.push('Bundles must not include ai.agentrig/install.json — it is a derived delivery artifact')
        continue
      }
      if (entry.filename === 'README.md') continue
      if (!isAllowedExtension(entry.filename, policy) && !isAllowedFilename(entry.filename, policy)) {
        const bytes = await entry.getData(new Uint8ArrayWriter(), { useWebWorkers: false })
        if (isProbablyBinary(bytes)) {
          errors.push(`Binary file not allowed: ${entry.filename}`)
        }
      }
    }

    if (errors.length || !manifest) {
      throw new PluginSubmissionValidationError(errors, warnings)
    }

    return {
      manifest,
      fileCount: entries.length,
      totalBytes: archiveValidation.totalBytes,
      zipBytes: zipBytes.length,
      warnings,
    }
  } finally {
    await zipReader.close()
  }
}

export function formatPluginValidationMessages(messages: string[]) {
  return messages.map((message) => `- ${message}`).join('\n')
}
