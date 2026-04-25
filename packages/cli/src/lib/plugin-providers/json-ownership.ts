import type { PluginJsonWrite } from '../types'

export type ProviderJsonOwnershipRecord = {
  path: string
  keyPath: string
  writtenValueDigest: string
  previousValueDigest?: string
  keys?: string[]
}

export function createProviderJsonWrite(record: ProviderJsonOwnershipRecord): PluginJsonWrite {
  return {
    path: record.path,
    keyPath: record.keyPath,
    writtenValueSha256: record.writtenValueDigest,
    ...(record.previousValueDigest ? { previousValueSha256: record.previousValueDigest } : {}),
    ...(record.keys ? { keys: record.keys } : {}),
  }
}

export function formatKeptModifiedJsonWrite(path: string, keyPath: string): string {
  return `kept modified: ${path}:${keyPath}`
}
