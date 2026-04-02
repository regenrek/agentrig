import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { RegistryRef } from '../../src/lib/types'
import {
  readSourceFile,
  resolvePluginFromManifestSpec,
  resolvePluginFromRegistryRef,
} from '../../src/lib/registry'

const originalFetch = globalThis.fetch

describe('registry resolution', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('resolves registry plugins via registry.json and manifests/<id>.json', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'agentrig',
            homepage: 'https://agentrig.ai',
            items: [
              {
                id: 'demo-plugin',
                name: 'Demo Plugin',
                description: 'Demo plugin',
                version: '1.2.3',
                kind: 'agentrig:plugin',
                manifest: 'manifests/demo-plugin.json',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            latest: '1.2.3',
            versions: ['1.2.3'],
            description: 'Demo plugin',
            trustTier: 'official',
            paths: {
              plugin: 'plugins/demo-plugin/1.2.3',
              manifest: 'manifests/demo-plugin.json',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            description: 'Demo plugin',
            version: '1.2.3',
            kind: 'agentrig:plugin',
configSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [{ path: 'skills/demo/SKILL.md', sha256: 'a'.repeat(64) }],
          }),
          { status: 200 },
        ),
      )

    const registry: RegistryRef = {
      name: 'official',
      url: 'https://agentrig.ai/registry',
    }

    const resolved = await resolvePluginFromRegistryRef(registry, 'demo-plugin')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://agentrig.ai/registry/registry.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://agentrig.ai/registry/manifests/demo-plugin.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/plugin.json',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/install.json',
      expect.any(Object),
    )
    expect(resolved.source).toEqual({
      type: 'url',
      baseUrl: 'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/',
    })
    expect('files' in resolved.manifest).toBe(false)
    expect(resolved.installMetadata?.files).toEqual([
      { path: 'skills/demo/SKILL.md', sha256: 'a'.repeat(64) },
    ])
    expect(resolved.trustTier).toBe('official')
  })

  it('fails closed when registry install metadata is missing', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'agentrig',
            homepage: 'https://agentrig.ai',
            items: [
              {
                id: 'demo-plugin',
                name: 'Demo Plugin',
                description: 'Demo plugin',
                version: '1.2.3',
                kind: 'agentrig:plugin',
                manifest: 'manifests/demo-plugin.json',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            latest: '1.2.3',
            versions: ['1.2.3'],
            description: 'Demo plugin',
            trustTier: 'official',
            paths: {
              plugin: 'plugins/demo-plugin/1.2.3',
              manifest: 'manifests/demo-plugin.json',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            description: 'Demo plugin',
            version: '1.2.3',
            kind: 'agentrig:plugin',
configSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))

    await expect(
      resolvePluginFromRegistryRef(
        { name: 'official', url: 'https://agentrig.ai/registry' },
        'demo-plugin',
      ),
    ).rejects.toThrow(/install\.json/i)
  })

  it('fails closed when registry install metadata is invalid', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'agentrig',
            homepage: 'https://agentrig.ai',
            items: [
              {
                id: 'demo-plugin',
                name: 'Demo Plugin',
                description: 'Demo plugin',
                version: '1.2.3',
                kind: 'agentrig:plugin',
                manifest: 'manifests/demo-plugin.json',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            latest: '1.2.3',
            versions: ['1.2.3'],
            description: 'Demo plugin',
            trustTier: 'official',
            paths: {
              plugin: 'plugins/demo-plugin/1.2.3',
              manifest: 'manifests/demo-plugin.json',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            description: 'Demo plugin',
            version: '1.2.3',
            kind: 'agentrig:plugin',
configSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: 'nope' }), { status: 200 }),
      )

    await expect(
      resolvePluginFromRegistryRef(
        { name: 'official', url: 'https://agentrig.ai/registry' },
        'demo-plugin',
      ),
    ).rejects.toThrow(/files must be an array/i)
  })

  it('fails closed when registry install metadata is empty', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'agentrig',
            homepage: 'https://agentrig.ai',
            items: [
              {
                id: 'demo-plugin',
                name: 'Demo Plugin',
                description: 'Demo plugin',
                version: '1.2.3',
                kind: 'agentrig:plugin',
                manifest: 'manifests/demo-plugin.json',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            latest: '1.2.3',
            versions: ['1.2.3'],
            description: 'Demo plugin',
            trustTier: 'official',
            paths: {
              plugin: 'plugins/demo-plugin/1.2.3',
              manifest: 'manifests/demo-plugin.json',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            description: 'Demo plugin',
            version: '1.2.3',
            kind: 'agentrig:plugin',
configSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [] }), { status: 200 }),
      )

    await expect(
      resolvePluginFromRegistryRef(
        { name: 'official', url: 'https://agentrig.ai/registry' },
        'demo-plugin',
      ),
    ).rejects.toThrow(/must not be empty/i)
  })

  it('treats direct .plugin/plugin.json URLs as plugin-root relative sources', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'demo-plugin',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.2.3',
          kind: 'agentrig:plugin',
configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        }),
        { status: 200 },
      ),
    )
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [{ path: 'README.md', sha256: 'a'.repeat(64) }] }), {
        status: 200,
      }),
    )

    const resolved = await resolvePluginFromManifestSpec(
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/plugin.json',
      '/repo',
    )

    expect(resolved.source).toEqual({
      type: 'url',
      baseUrl: 'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/',
    })
    expect(resolved.installMetadata?.files).toEqual([{ path: 'README.md', sha256: 'a'.repeat(64) }])
  })

  it('preserves query parameters for direct manifest install metadata and file reads', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            description: 'Demo plugin',
            version: '1.2.3',
            kind: 'agentrig:plugin',
            configSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [{ path: 'README.md', sha256: 'a'.repeat(64) }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('# Demo Plugin\n', { status: 200 }))

    const resolved = await resolvePluginFromManifestSpec(
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/plugin.json?token=secret',
      '/repo',
    )

    const bytes = await readSourceFile(resolved.source, 'README.md')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/plugin.json?token=secret',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/install.json?token=secret',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/README.md?token=secret',
      expect.any(Object),
    )
    expect(new TextDecoder().decode(bytes)).toBe('# Demo Plugin\n')
  })

  it('fails closed when direct plugin manifest URLs are missing install metadata', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'demo-plugin',
            name: 'Demo Plugin',
            description: 'Demo plugin',
            version: '1.2.3',
            kind: 'agentrig:plugin',
configSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))

    await expect(
      resolvePluginFromManifestSpec(
        'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/.plugin/plugin.json',
        '/repo',
      ),
    ).rejects.toThrow(/install\.json/i)
  })

  it('rejects remote manifest URLs that do not point to /.plugin/plugin.json', async () => {
    await expect(
      resolvePluginFromManifestSpec(
        'https://agentrig.ai/registry/plugins/demo-plugin/1.2.3/manifest.json',
        '/repo',
      ),
    ).rejects.toThrow(/must point to \/\.plugin\/plugin\.json/i)
  })

  it('falls back to canonical local source files when a manifest path has no install.json', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-local-plugin-'))
    try {
      const pluginRoot = path.join(tempRoot, 'demo-plugin')
      await fs.mkdir(path.join(pluginRoot, '.plugin'), { recursive: true })
      await fs.mkdir(path.join(pluginRoot, 'skills', 'demo'), { recursive: true })
      await fs.mkdir(path.join(pluginRoot, 'scripts'), { recursive: true })
      await fs.writeFile(
        path.join(pluginRoot, '.plugin', 'plugin.json'),
        JSON.stringify({
          id: 'demo-plugin',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.0.0',
          kind: 'agentrig:plugin',
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        })
      )
      await fs.writeFile(path.join(pluginRoot, 'skills', 'demo', 'SKILL.md'), '# Demo skill\n')
      await fs.writeFile(path.join(pluginRoot, 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho demo\n')
      await fs.writeFile(path.join(pluginRoot, 'LICENSE'), 'MIT\n')
      await fs.writeFile(path.join(pluginRoot, 'notes.txt'), 'ignore me\n')
      await fs.chmod(path.join(pluginRoot, 'scripts', 'run.sh'), 0o755)

      const resolved = await resolvePluginFromManifestSpec(
        path.join(pluginRoot, '.plugin', 'plugin.json'),
        '/repo'
      )

      expect(resolved.installMetadata?.files).toEqual([
        { path: 'LICENSE', mode: undefined },
        { path: 'scripts/run.sh', mode: '755' },
        { path: 'skills/demo/SKILL.md', mode: undefined },
      ])
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails when local install metadata exists but is invalid', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-local-plugin-'))
    try {
      const pluginRoot = path.join(tempRoot, 'demo-plugin')
      await fs.mkdir(path.join(pluginRoot, '.plugin'), { recursive: true })
      await fs.writeFile(
        path.join(pluginRoot, '.plugin', 'plugin.json'),
        JSON.stringify({
          id: 'demo-plugin',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.0.0',
          kind: 'agentrig:plugin',
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        }),
      )
      await fs.writeFile(path.join(pluginRoot, '.plugin', 'install.json'), JSON.stringify({ files: 'bad' }))

      await expect(
        resolvePluginFromManifestSpec(path.join(pluginRoot, '.plugin', 'plugin.json'), '/repo'),
      ).rejects.toThrow(/files must be an array/i)
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails when registry history manifest id does not match the requested plugin', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'agentrig',
            homepage: 'https://agentrig.ai',
            items: [
              {
                id: 'demo-plugin',
                name: 'Demo Plugin',
                description: 'Demo plugin',
                version: '1.2.3',
                kind: 'agentrig:plugin',
                manifest: 'manifests/demo-plugin.json',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'other-plugin',
            name: 'Demo Plugin',
            latest: '1.2.3',
            versions: ['1.2.3'],
            description: 'Demo plugin',
            trustTier: 'official',
            paths: {
              plugin: 'plugins/demo-plugin/1.2.3',
              manifest: 'manifests/demo-plugin.json',
            },
          }),
          { status: 200 },
        ),
      )

    await expect(
      resolvePluginFromRegistryRef(
        { name: 'official', url: 'https://agentrig.ai/registry' },
        'demo-plugin',
      ),
    ).rejects.toThrow(/manifest id mismatch/i)
  })
})
