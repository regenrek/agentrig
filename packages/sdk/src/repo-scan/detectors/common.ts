import { providerAffinityForSignal, providerCompatForSignal } from '../../provider/affinity'
import type { Signal, SignalFile, SignalKind } from '../types'
import type { VirtualTree, VirtualTreeFile } from '../virtual-tree'
import { normalizeVirtualPath, virtualBasename } from '../virtual-tree'

export type DetectorInput = {
  tree: VirtualTree
  files: VirtualTreeFile[]
}

export type SignalDetector = (input: DetectorInput) => Promise<Signal[]> | Signal[]

type SignalDraft = {
  kind: SignalKind
  id: string
  title: string
  description?: string
  sourcePath: string
  files: SignalFile[]
  score: number
  notes?: string[]
}

export function slugifySignalId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function titleFromPath(path: string) {
  const basename = virtualBasename(path).replace(/\.[^.]+$/, '')
  const title = basename.replace(/[-_]+/g, ' ').trim()
  return title ? title.replace(/\b\w/g, (match) => match.toUpperCase()) : basename
}

export function idFromPath(path: string) {
  return slugifySignalId(path.replace(/\.[^.]+$/, ''))
}

export function filesForExact(files: readonly VirtualTreeFile[], path: string) {
  const normalized = normalizeVirtualPath(path)
  return files
    .filter((file) => normalizeVirtualPath(file.path) === normalized)
    .map(signalFileFromTreeFile)
}

export function filesForPrefix(files: readonly VirtualTreeFile[], prefix: string) {
  const normalized = normalizeVirtualPath(prefix)
  const directoryPrefix = `${normalized}/`
  return files
    .filter((file) => {
      const filePath = normalizeVirtualPath(file.path)
      return filePath === normalized || filePath.startsWith(directoryPrefix)
    })
    .map(signalFileFromTreeFile)
}

export function signalFileFromTreeFile(file: VirtualTreeFile): SignalFile {
  return {
    path: normalizeVirtualPath(file.path),
    sha256: file.sha256,
    bytes: file.bytes,
  }
}

export function createSignal(draft: SignalDraft): Signal {
  const sourcePath = normalizeVirtualPath(draft.sourcePath)
  return {
    kind: draft.kind,
    id: draft.id,
    title: draft.title,
    ...(draft.description ? { description: draft.description } : {}),
    sourcePath,
    files: [...draft.files].sort((left, right) => left.path.localeCompare(right.path)),
    providerAffinity: providerAffinityForSignal(draft.kind, sourcePath),
    providerCompat: providerCompatForSignal(draft.kind, sourcePath),
    score: draft.score,
    ...(draft.notes?.length ? { notes: draft.notes } : {}),
  }
}
