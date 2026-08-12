import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_PLUGIN_MANIFEST_SCHEMA_URL } from './agent-plugins'
import { inspectAgentPluginPackageDirectory } from './agent-plugin-package-fs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentrig-package-test-'))
  temporaryRoots.push(root)
  return root
}

async function writeManifest(root: string, name = 'filesystem-test') {
  await fs.writeFile(path.join(root, 'plugin.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
    name,
  }))
}

describe('Agent Plugin package filesystem boundary', () => {
  it('discovers only canonical paths and preserves empty canonical files for semantic validation', async () => {
    const root = await temporaryRoot()
    await fs.mkdir(path.join(root, 'skills', 'review', 'nested'), { recursive: true })
    await writeManifest(root)
    await fs.writeFile(
      path.join(root, 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Reviews changes.\n---\n# Review\n',
    )
    await fs.writeFile(
      path.join(root, 'skills', 'review', 'nested', 'SKILL.md'),
      '---\nname: nested\ndescription: Must not be discovered.\n---\n# Nested\n',
    )
    await fs.writeFile(path.join(root, '.mcp.json'), '{not-canonical')
    await fs.writeFile(path.join(root, 'mcp.json'), '')

    const result = await inspectAgentPluginPackageDirectory(root)

    expect(result.components.skills.map((skill) => skill.frontmatter.name)).toEqual(['review'])
    expect(result.components.mcpServers).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['mcp.invalid-document'])
    expect(result.conformance).toEqual({ loadable: true, portable: false, publishable: false })
  })

  it('isolates component symlink escapes and rejects a manifest symlink escape fatally', async () => {
    const base = await temporaryRoot()
    const root = path.join(base, 'plugin')
    const outside = path.join(base, 'outside')
    await fs.mkdir(path.join(root, 'skills'), { recursive: true })
    await fs.mkdir(path.join(outside, 'escape'), { recursive: true })
    await writeManifest(root)
    await fs.writeFile(
      path.join(outside, 'escape', 'SKILL.md'),
      '---\nname: escape\ndescription: Outside root.\n---\n# Escape\n',
    )
    await fs.writeFile(path.join(outside, 'mcp.json'), '{}')
    await fs.symlink(path.join(outside, 'escape'), path.join(root, 'skills', 'escape'))
    await fs.symlink(path.join(outside, 'mcp.json'), path.join(root, 'mcp.json'))

    const components = await inspectAgentPluginPackageDirectory(root)
    expect(components.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'filesystem.path-escape',
      'filesystem.path-escape',
    ])
    expect(components.conformance.loadable).toBe(true)

    const escapedManifestRoot = path.join(base, 'escaped-manifest')
    await fs.mkdir(escapedManifestRoot)
    await fs.writeFile(path.join(outside, 'plugin.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA_URL,
      name: 'outside',
    }))
    await fs.symlink(path.join(outside, 'plugin.json'), path.join(escapedManifestRoot, 'plugin.json'))

    const manifest = await inspectAgentPluginPackageDirectory(escapedManifestRoot)
    expect(manifest.conformance.loadable).toBe(false)
    expect(manifest.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['filesystem.path-escape'])
  })
})
