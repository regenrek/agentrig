import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { PackMeta, RegistryIndex } from '../../src/lib/types'
import {
  OFFICIAL_REGISTRY_URL,
  buildUrlAndHeadersForNamespacedItem,
  fetchDirectoryIndex,
  findRegistryInDirectory,
  isFileish,
  isUrl,
  joinUrl,
  readRegistryIndex,
  readSourceFile,
  resolvePackByName,
  resolvePackFromMetaSpec,
  resolvePackFromNamespacedRegistry,
} from '../../src/lib/registry'
import { readJsonFile } from '../../src/lib/fs'

vi.mock('../../src/lib/fs', () => ({
  readJsonFile: vi.fn(),
}))

const okResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const errorResponse = (status = 404) =>
  new Response(JSON.stringify({}), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('registry', () => {
  let baseDir = ''

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-registry-'))
  })

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects URLs and file-like specs', () => {
    expect(isUrl('https://example.com')).toBe(true)
    expect(isUrl('file.json')).toBe(false)
    expect(isFileish('file.json')).toBe(true)
    expect(isFileish('./local')).toBe(true)
    expect(isFileish('../local')).toBe(true)
    expect(isFileish('/absolute')).toBe(true)
    expect(isFileish('C:\\path\\file')).toBe(true)
  })

  it('joins URLs correctly', () => {
    expect(joinUrl('https://example.com/registry', 'core.json')).toBe(
      'https://example.com/registry/core.json'
    )
    expect(joinUrl('https://example.com/registry/', 'core.json')).toBe(
      'https://example.com/registry/core.json'
    )
    expect(joinUrl('https://example.com/registry/', 'https://example.com/assets/a.json')).toBe(
      'https://example.com/assets/a.json'
    )
    expect(() => joinUrl('https://example.com/registry/', 'https://other.com/a.json')).toThrow(
      'External URLs are not allowed'
    )
  })

  it('fetches directory index', async () => {
    const entries = [{ name: '@acme', url: 'https://acme/{name}.json', verified: true }]
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(entries))
    await expect(fetchDirectoryIndex('https://example.com/index.json')).resolves.toEqual(entries)
  })

  it('finds a registry in directory', async () => {
    const entries = [
      { name: '@acme', url: 'https://acme/{name}.json', verified: true },
      { name: '@other', url: 'https://other/{name}.json', verified: false },
    ]
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(entries))
    await expect(findRegistryInDirectory('@acme', 'https://example.com/index.json')).resolves.toEqual(
      entries[0]
    )
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(entries))
    await expect(findRegistryInDirectory('@missing', 'https://example.com/index.json')).resolves.toBeNull()
  })

  it('builds URL and headers for namespaced registries', () => {
    process.env.API_TOKEN = 'secret'
    process.env.VERSION = 'v1'

    const result = buildUrlAndHeadersForNamespacedItem('pack', {
      url: 'https://example.com/{name}.json',
      headers: { Authorization: 'Bearer ${API_TOKEN}' },
      params: { version: '${VERSION}' },
    })

    expect(result.headers).toEqual({ Authorization: 'Bearer secret' })
    expect(result.url).toBe('https://example.com/pack.json?version=v1')
  })

  it('rejects missing env vars for headers', () => {
    delete process.env.MISSING_VAR
    expect(() =>
      buildUrlAndHeadersForNamespacedItem('pack', {
        url: 'https://example.com/{name}.json',
        headers: { Authorization: 'Bearer ${MISSING_VAR}' },
      })
    ).toThrow('Environment variable MISSING_VAR is not set')
  })

  it('resolves a namespaced registry pack', async () => {
    const meta: PackMeta = {
      name: 'pack',
      title: 'Pack',
      description: 'Test',
      version: '1.0.0',
      files: [],
    }
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(meta))

    const result = await resolvePackFromNamespacedRegistry('@acme/pack', {
      '@acme': 'https://example.com/{name}.json',
    })

    expect(result.meta).toEqual(meta)
    expect(result.source).toEqual({ type: 'url', baseUrl: 'https://example.com/' })
    expect(result.sourceLabel).toBe('@acme/pack')
  })

  it('rejects invalid namespaced specs', async () => {
    await expect(
      resolvePackFromNamespacedRegistry('pack', { '@acme': 'https://example.com/{name}.json' })
    ).rejects.toThrow('Invalid namespaced pack spec')

    await expect(
      resolvePackFromNamespacedRegistry('@acme/Bad', { '@acme': 'https://example.com/{name}.json' })
    ).rejects.toThrow('Invalid pack name in namespaced spec')

    await expect(resolvePackFromNamespacedRegistry('@missing/pack', {})).rejects.toThrow(
      'Registry "@missing" is not configured'
    )
  })

  it('reads registry index', async () => {
    const registryIndex: RegistryIndex = {
      name: 'registry',
      items: [
        {
          name: 'core',
          title: 'Core',
          description: 'Core pack',
          meta: 'core.json',
        },
      ],
    }
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(registryIndex))
    await expect(readRegistryIndex('https://example.com/registry')).resolves.toEqual(registryIndex)
  })

  it('resolves a pack by name with fallback', async () => {
    const meta: PackMeta = {
      name: 'pack',
      title: 'Pack',
      description: 'Test',
      version: '1.0.0',
      files: [],
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(okResponse(meta))

    const result = await resolvePackByName(
      'pack',
      [
        { name: 'broken', url: 'https://broken.example.com' },
        { name: 'working', url: OFFICIAL_REGISTRY_URL },
      ],
      'broken'
    )

    expect(result.meta).toEqual(meta)
    expect(result.source).toEqual({ type: 'url', baseUrl: OFFICIAL_REGISTRY_URL })
    expect(result.trustTier).toBe('official')
  })

  it('throws when pack cannot be resolved', async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(404))
    await expect(resolvePackByName('pack', [{ name: 'broken', url: 'https://broken.example.com' }])).rejects.toThrow(
      'Unable to resolve pack "pack"'
    )
  })

  it('resolves pack meta by URL spec', async () => {
    const meta: PackMeta = {
      name: 'pack',
      title: 'Pack',
      description: 'Test',
      version: '1.0.0',
      files: [],
    }
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(meta))
    const result = await resolvePackFromMetaSpec('https://example.com/pack.json', '/repo')
    expect(result.meta).toEqual(meta)
    expect(result.source).toEqual({ type: 'url', baseUrl: 'https://example.com/' })
    expect(result.sourceLabel).toBe('url:https://example.com/pack.json')
  })

  it('resolves pack meta by local file spec', async () => {
    const meta: PackMeta = {
      name: 'pack',
      title: 'Pack',
      description: 'Test',
      version: '1.0.0',
      files: [],
    }
    vi.mocked(readJsonFile).mockResolvedValueOnce(meta)
    const result = await resolvePackFromMetaSpec('packs/pack.json', '/repo')
    expect(result.meta).toEqual(meta)
    expect(result.source).toEqual({ type: 'fs', baseDir: '/repo/packs' })
    expect(result.sourceLabel).toBe('file:/repo/packs/pack.json')
  })

  it('throws when local meta file is missing', async () => {
    vi.mocked(readJsonFile).mockResolvedValueOnce(null)
    await expect(resolvePackFromMetaSpec('packs/pack.json', '/repo')).rejects.toThrow(
      'Meta file not found: /repo/packs/pack.json'
    )
  })

  it('reads source files from URLs and filesystem', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ content: 'hello' }))
    const urlData = await readSourceFile({ type: 'url', baseUrl: 'https://example.com/' }, 'file.json')
    expect(urlData).toBeInstanceOf(Uint8Array)

    const localPath = path.join(baseDir, 'local.txt')
    await fs.writeFile(localPath, 'hello', 'utf-8')
    const fsData = await readSourceFile({ type: 'fs', baseDir }, 'local.txt')
    expect(new TextDecoder().decode(fsData)).toBe('hello')
  })
})
