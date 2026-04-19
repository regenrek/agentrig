import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRegistry } from '../../../../scripts/build-registry'

describe('buildRegistry plugin output', () => {
  const tempDirs: string[] = []

  function sha256Hex(value: string) {
    return createHash('sha256').update(Buffer.from(value)).digest('hex')
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  async function writeSourceRegistry(args: {
    repoRoot: string
    pluginId: string
    name: string
    description: string
    version: string
    keywords?: string[]
  }) {
    const { repoRoot, pluginId, name, description, version, keywords } = args
    const pluginRoot = path.join(repoRoot, 'plugins')
    const manifestsRoot = path.join(repoRoot, 'manifests')
    const versionDir = path.join(pluginRoot, pluginId, version)
    const pluginManifestPath = path.join(versionDir, '.plugin', 'plugin.json')
    const historyManifestPath = path.join(manifestsRoot, `${pluginId}.json`)

    await fs.mkdir(path.dirname(pluginManifestPath), { recursive: true })
    await fs.mkdir(path.dirname(historyManifestPath), { recursive: true })
    await fs.writeFile(path.join(versionDir, 'README.md'), '# Demo\n')
    await fs.writeFile(
      pluginManifestPath,
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          kind: 'agentrig:plugin',
          id: pluginId,
          name,
          description,
          version,
          author: 'agentrig',
          pluginDependencies: [],
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        null,
        2,
      ) + '\n',
    )

    await fs.writeFile(
      historyManifestPath,
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/plugin-history.json',
          id: pluginId,
          name,
          latest: version,
          versions: [version],
          description,
          keywords,
          trustTier: 'official',
          paths: {
            plugin: `plugins/${pluginId}/${version}`,
            manifest: `manifests/${pluginId}.json`,
          },
        },
        null,
        2,
      ) + '\n',
    )
    await fs.writeFile(
      path.join(repoRoot, 'registry.json'),
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/registry.v1.json',
          name: 'agentrig',
          homepage: 'https://agentrig.ai',
          items: [
            {
              id: pluginId,
              name,
              description,
              version,
              keywords,
              manifest: `manifests/${pluginId}.json`,
            },
          ],
        },
        null,
        2,
      ) + '\n',
    )
  }

  it('publishes plugin manifests and history manifests together', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-registry-build-'))
    tempDirs.push(tempRoot)

    const repoRoot = path.join(tempRoot, 'repo')
    const outputRoot = path.join(tempRoot, 'output')
    await writeSourceRegistry({
      repoRoot,
      pluginId: 'demo',
      name: 'Demo Plugin',
      description: 'Demo plugin',
      version: '1.0.0',
    })

    await buildRegistry({
      repoRoot,
      pluginRoot: path.join(repoRoot, 'plugins'),
      outputRoot,
    })

    const canonicalPlugin = JSON.parse(
      await fs.readFile(path.join(outputRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'plugin.json'), 'utf-8')
    ) as {
      files?: Array<{ path: string }>
    }
    const installMetadata = JSON.parse(
      await fs.readFile(path.join(outputRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'install.json'), 'utf-8')
    ) as {
      $schema: string
      files: Array<{ path: string }>
    }
    const registryIndex = JSON.parse(await fs.readFile(path.join(outputRoot, 'registry.json'), 'utf-8')) as {
      items: Array<{ id: string; manifest: string }>
    }

    await expect(fs.stat(path.join(outputRoot, 'manifests', 'demo.json'))).resolves.toBeDefined()
    expect(canonicalPlugin.files).toBeUndefined()
    expect(installMetadata.$schema).toBe('https://agentrig.ai/schema/plugin-install.v1.json')
    expect(installMetadata.files.some((file) => file.path === 'README.md')).toBe(true)
    await expect(fs.stat(path.join(outputRoot, 'demo.json'))).rejects.toThrow()
    expect(registryIndex.items).toEqual([
      expect.objectContaining({ id: 'demo', manifest: 'manifests/demo.json' }),
    ])
  })

  it('hashes the canonical output bytes for .plugin/plugin.json', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-registry-build-'))
    tempDirs.push(tempRoot)

    const repoRoot = path.join(tempRoot, 'repo')
    const outputRoot = path.join(tempRoot, 'output')
    await writeSourceRegistry({
      repoRoot,
      pluginId: 'demo',
      name: 'Demo Plugin',
      description: 'Demo plugin',
      version: '1.0.0',
    })

    await fs.writeFile(
      path.join(repoRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'plugin.json'),
      JSON.stringify({
        version: '1.0.0',
        description: 'Demo plugin',
        id: 'demo',
        kind: 'agentrig:plugin',
        name: 'Demo Plugin',
        $schema: 'https://agentrig.ai/schema/plugin.v1.json',
        author: 'agentrig',
        pluginDependencies: [],
        configSchema: {
          properties: {},
          additionalProperties: false,
          type: 'object',
        },
      }),
      'utf-8',
    )

    await buildRegistry({
      repoRoot,
      pluginRoot: path.join(repoRoot, 'plugins'),
      outputRoot,
    })

    const canonicalPluginBytes = await fs.readFile(
      path.join(outputRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'plugin.json'),
      'utf-8'
    )
    const installMetadata = JSON.parse(
      await fs.readFile(path.join(outputRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'install.json'), 'utf-8')
    ) as {
      files: Array<{ path: string; sha256?: string }>
    }
    const manifestFile = installMetadata.files.find((file) => file.path === '.plugin/plugin.json')
    expect(manifestFile?.sha256).toBe(sha256Hex(canonicalPluginBytes))
  })

  it('selects the latest version using semver ordering', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-registry-build-'))
    tempDirs.push(tempRoot)

    const repoRoot = path.join(tempRoot, 'repo')
    await writeSourceRegistry({
      repoRoot,
      pluginId: 'demo',
      name: 'Demo Plugin',
      description: 'Demo plugin',
      version: '10.0.0',
    })

    const olderVersionDir = path.join(repoRoot, 'plugins', 'demo', '2.0.0')
    await fs.mkdir(path.join(olderVersionDir, '.plugin'), { recursive: true })
    await fs.writeFile(path.join(olderVersionDir, 'README.md'), '# Older\n')
    await fs.writeFile(
      path.join(olderVersionDir, '.plugin', 'plugin.json'),
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          kind: 'agentrig:plugin',
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '2.0.0',
          author: 'agentrig',
          pluginDependencies: [],
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        null,
        2,
      ) + '\n',
    )
    await fs.writeFile(
      path.join(repoRoot, 'manifests', 'demo.json'),
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/plugin-history.json',
          id: 'demo',
          name: 'Demo Plugin',
          latest: '10.0.0',
          versions: ['2.0.0', '10.0.0'],
          description: 'Demo plugin',
          trustTier: 'official',
          paths: {
            plugin: 'plugins/demo/10.0.0',
            manifest: 'manifests/demo.json',
          },
        },
        null,
        2,
      ) + '\n',
    )

    const outputRoot = path.join(tempRoot, 'output')
    await buildRegistry({
      repoRoot,
      pluginRoot: path.join(repoRoot, 'plugins'),
      outputRoot,
    })

    const canonicalPlugin = JSON.parse(
      await fs.readFile(path.join(outputRoot, 'plugins', 'demo', '10.0.0', '.plugin', 'plugin.json'), 'utf-8')
    ) as {
      version: string
      files?: Array<{ path: string }>
    }
    const installMetadata = JSON.parse(
      await fs.readFile(path.join(outputRoot, 'plugins', 'demo', '10.0.0', '.plugin', 'install.json'), 'utf-8')
    ) as {
      $schema?: string
      files: Array<{ path: string }>
    }
    expect(canonicalPlugin.version).toBe('10.0.0')
    expect(canonicalPlugin.files).toBeUndefined()
    expect(installMetadata.files.some((file) => file.path === 'README.md')).toBe(true)
  })

  it('fails when the source manifest claims the wrong schema url', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-registry-build-'))
    tempDirs.push(tempRoot)

    const repoRoot = path.join(tempRoot, 'repo')
    await writeSourceRegistry({
      repoRoot,
      pluginId: 'demo',
      name: 'Demo Plugin',
      description: 'Demo plugin',
      version: '1.0.0',
    })

    await fs.writeFile(
      path.join(repoRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'plugin.json'),
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/plugin.json',
          kind: 'agentrig:plugin',
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.0.0',
          author: 'agentrig',
          pluginDependencies: [],
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        null,
        2,
      ) + '\n',
    )

    await expect(
      buildRegistry({
        repoRoot,
        pluginRoot: path.join(repoRoot, 'plugins'),
        outputRoot: path.join(tempRoot, 'output'),
      })
    ).rejects.toThrow(/\$schema must be/)
  })

  it('fails when the manifest version does not match the version directory', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-registry-build-'))
    tempDirs.push(tempRoot)

    const repoRoot = path.join(tempRoot, 'repo')
    await writeSourceRegistry({
      repoRoot,
      pluginId: 'demo',
      name: 'Demo Plugin',
      description: 'Demo plugin',
      version: '1.0.0',
    })

    await fs.writeFile(
      path.join(repoRoot, 'plugins', 'demo', '1.0.0', '.plugin', 'plugin.json'),
      JSON.stringify(
        {
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          kind: 'agentrig:plugin',
          id: 'demo',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '9.9.9',
          author: 'agentrig',
          pluginDependencies: [],
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        null,
        2,
      ) + '\n',
    )

    await expect(
      buildRegistry({
        repoRoot,
        pluginRoot: path.join(repoRoot, 'plugins'),
        outputRoot: path.join(tempRoot, 'output'),
      })
    ).rejects.toThrow(/version mismatch/i)
  })
})
