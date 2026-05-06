import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import inspectCommand from '../../src/commands/inspect'
import useCommand from '../../src/commands/use'
import { createPluginBundle } from '../../src/lib/plugin-bundle'
import { LOCAL_PLUGIN_POLICY } from '../../src/lib/registry'
import { validatePluginBundle } from '../../src/lib/plugin-submission-validation'

const tempDirs: string[] = []
const originalCwd = process.cwd()
const originalHome = process.env.HOME
const dotsLikeFixture = fileURLToPath(new URL('../../../sdk/tests/fixtures/dots-like', import.meta.url))

describe('commands: inspect/use', () => {
  const inspectRun = inspectCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>
  const useRun = useCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    process.chdir(originalCwd)
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('prints deterministic inspect JSON for a local repo', async () => {
    const fixture = await createFixture()
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line = '') => logs.push(String(line)))

    await inspectRun({
      args: {
        source: fixture,
        json: true,
        ref: undefined,
        path: undefined,
        'only-kind': 'skill',
        help: false,
      },
    })

    const report = JSON.parse(logs.join('\n')) as { digest: string; signals: Array<{ kind: string; sourcePath: string }> }
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(report.signals).toMatchObject([{ kind: 'skill', sourcePath: 'skills/review' }])
  })

  it('rejects unsupported remote sources before any authenticated download', async () => {
    await expect(inspectRun({
      args: {
        source: 'https://gitlab.example.com/acme/repo',
        json: true,
        ref: undefined,
        path: undefined,
        'only-kind': undefined,
        help: false,
      },
    })).rejects.toThrow('Unsupported remote source')
  })

  it('materializes picked local signals as a plugin directory', async () => {
    const fixture = await createFixture()
    const outDir = path.join(await tempRoot(), 'community.review')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await useRun({
      args: {
        source: fixture,
        'as-plugin': 'community.review',
        out: outDir,
        pick: 'skills/review,.mcp.json',
        yes: false,
        'dry-run': false,
        install: false,
        ref: undefined,
        path: undefined,
        help: false,
      },
    })

    const manifest = JSON.parse(await fs.readFile(path.join(outDir, '.plugin', 'plugin.json'), 'utf-8')) as {
      id: string
      'x-agentrig': { source: { kind: string; repoUrl: string; pickedSignalPaths: string[] } }
    }
    expect(manifest.id).toBe('community.review')
    expect(manifest['x-agentrig'].source.kind).toBe('external-repo')
    expect(manifest['x-agentrig'].source.repoUrl).toBe(pathToFileURL(fixture).href)
    expect(manifest['x-agentrig'].source.pickedSignalPaths).toEqual(['.mcp.json', 'skills/review'])
    await expect(fs.readFile(path.join(outDir, 'skills', 'review', 'SKILL.md'), 'utf-8')).resolves.toContain('Reviews code.')
    await expect(fs.readFile(path.join(outDir, '.mcp.json'), 'utf-8')).resolves.toContain('mcpServers')

    const bundle = await createPluginBundle({
      dir: outDir,
      policy: LOCAL_PLUGIN_POLICY,
      temporary: true,
    })
    const validation = await validatePluginBundle(bundle.zipBytes, LOCAL_PLUGIN_POLICY)
    expect(validation.fileCount).toBeGreaterThan(0)
  })

  it('bundles picked signals from the golden dots-like fixture', async () => {
    const outDir = path.join(await tempRoot(), 'community.dots-like')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await useRun({
      args: {
        source: dotsLikeFixture,
        'as-plugin': 'community.dots-like',
        out: outDir,
        pick: 'skills/review,.claude/commands/review.md,prompts/debug.md,.mcp.json',
        yes: false,
        'dry-run': false,
        install: false,
        ref: undefined,
        path: undefined,
        help: false,
      },
    })

    const bundle = await createPluginBundle({
      dir: outDir,
      policy: LOCAL_PLUGIN_POLICY,
      temporary: true,
    })
    const validation = await validatePluginBundle(bundle.zipBytes, LOCAL_PLUGIN_POLICY)
    expect(validation.fileCount).toBeGreaterThan(0)

    const manifest = JSON.parse(await fs.readFile(path.join(outDir, '.plugin', 'plugin.json'), 'utf-8')) as {
      'x-agentrig': { source: { kind: string; repoUrl: string; pickedSignalPaths: string[] } }
    }
    expect(manifest['x-agentrig'].source).toMatchObject({
      kind: 'external-repo',
      repoUrl: pathToFileURL(dotsLikeFixture).href,
      pickedSignalPaths: ['.claude/commands/review.md', '.mcp.json', 'prompts/debug.md', 'skills/review'],
    })
    await expect(fs.readFile(path.join(outDir, 'commands', 'review.md'), 'utf-8')).resolves.toContain('risk-first')
    await expect(fs.readFile(path.join(outDir, 'commands', 'debug.md'), 'utf-8')).resolves.toContain('first incorrect')
  })

  it('installs picked signals with external-repo ledger provenance', async () => {
    const cwd = await tempRoot()
    process.chdir(cwd)
    process.env.HOME = cwd
    const fixture = await createFixture()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await useRun({
      args: {
        source: fixture,
        'as-plugin': 'community.review',
        provider: 'cursor',
        scope: 'workspace',
        force: true,
        pick: 'skills/review',
        yes: false,
        'dry-run': false,
        install: true,
        ref: undefined,
        path: undefined,
        out: undefined,
        help: false,
      },
    })

    const ledger = JSON.parse(await fs.readFile(path.join(cwd, '.agentrig', 'plugin-installs.json'), 'utf-8')) as {
      installs: Record<string, unknown>
      selections: Record<string, { specIdentity: { kind: string; repoUrl?: string; scanDigest: string; pickedSignalPaths: string[] }; registry?: unknown; selectedSelectors: string[] }>
    }
    expect(ledger.installs).toEqual({})
    const record = Object.values(ledger.selections)[0]
    expect(record.specIdentity).toMatchObject({
      kind: 'external-repo',
      repoUrl: pathToFileURL(fixture).href,
      pickedSignalPaths: ['skills/review'],
    })
    expect(record.registry).toBeUndefined()
    expect(record.selectedSelectors).toEqual(['skill:review'])
    expect(record.specIdentity.scanDigest).toMatch(/^[a-f0-9]{64}$/)
    await expect(
      fs.readFile(path.join(cwd, '.cursor', 'skills', 'review', 'SKILL.md'), 'utf-8')
    ).resolves.toContain('Reviews code.')
  })

  it('honors AGENTRIG_HOME for personal external-repo install paths', async () => {
    const cwd = await tempRoot()
    const realHome = await tempRoot()
    const agentrigHome = await tempRoot()
    process.chdir(cwd)
    process.env.HOME = realHome
    vi.stubEnv('AGENTRIG_HOME', agentrigHome)
    const fixture = await createFixture()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await useRun({
      args: {
        source: fixture,
        'as-plugin': 'external.repo',
        provider: 'cursor',
        scope: 'personal',
        force: true,
        pick: 'skills/review',
        yes: false,
        'dry-run': false,
        install: true,
        ref: undefined,
        path: undefined,
        out: undefined,
        help: false,
      },
    })

    await expect(
      fs.readFile(path.join(agentrigHome, '.cursor', 'skills', 'review', 'SKILL.md'), 'utf-8')
    ).resolves.toContain('Reviews code.')
    await expect(
      fs.readFile(path.join(agentrigHome, '.agentrig', 'plugin-installs.json'), 'utf-8')
    ).resolves.toContain('external.repo')
    await expect(fs.stat(path.join(realHome, '.cursor'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(realHome, '.agentrig'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies local BYOK enrichment to plugin metadata', async () => {
    const fixture = await createFixture()
    const outDir = path.join(await tempRoot(), 'community.review')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('AGENTRIG_AI_BASE_URL', 'https://llm.example.com')
    vi.stubEnv('AGENTRIG_AI_API_KEY', 'test-key')
    vi.stubEnv('AGENTRIG_AI_MODEL', 'test-model')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    description: 'AI enriched description.',
                    keywords: ['review', 'workflow'],
                  }),
                },
              },
            ],
          })
        )
      )
    )

    await useRun({
      args: {
        source: fixture,
        'as-plugin': 'community.review',
        out: outDir,
        pick: 'skills/review',
        'enrich-ai': 'local',
        yes: false,
        'dry-run': false,
        install: false,
        force: false,
        ref: undefined,
        path: undefined,
        help: false,
      },
    })

    const manifest = JSON.parse(await fs.readFile(path.join(outDir, '.plugin', 'plugin.json'), 'utf-8')) as {
      description: string
      keywords: string[]
    }
    expect(manifest.description).toBe('AI enriched description.')
    expect(manifest.keywords).toEqual(['review', 'workflow'])
  })

  it('URL-encodes local external-repo identities', async () => {
    const root = await tempRoot()
    const fixture = path.join(root, 'repo with spaces')
    await createFixtureAt(fixture)
    const outDir = path.join(root, 'community.review')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await useRun({
      args: {
        source: fixture,
        'as-plugin': 'community.review',
        out: outDir,
        pick: 'skills/review',
        yes: false,
        'dry-run': false,
        install: false,
        force: false,
        ref: undefined,
        path: undefined,
        help: false,
      },
    })

    const manifest = JSON.parse(await fs.readFile(path.join(outDir, '.plugin', 'plugin.json'), 'utf-8')) as {
      'x-agentrig': { source: { repoUrl: string } }
    }
    expect(manifest['x-agentrig'].source.repoUrl).toBe(pathToFileURL(fixture).href)
    expect(manifest['x-agentrig'].source.repoUrl).toContain('%20')
  })
})

async function createFixture() {
  const root = await tempRoot()
  await createFixtureAt(root)
  return root
}

async function createFixtureAt(root: string) {
  await fs.mkdir(path.join(root, 'skills', 'review'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'skills', 'review', 'SKILL.md'),
    '---\nname: Review\ndescription: Reviews code.\n---\nBody\n'
  )
  await fs.writeFile(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { fs: { command: 'node' } } }))
}

async function tempRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-inspect-use-'))
  tempDirs.push(dir)
  return dir
}
