import { describe, expect, it } from 'vite-plus/test'
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js'
import {
  PluginSubmissionValidationError,
  validatePluginBundle,
} from '../../src/lib/plugin-submission-validation'
import { LOCAL_PLUGIN_POLICY } from '../../src/lib/registry'
import type { PluginUploadPolicySnapshot } from '../../src/lib/types'

const TEST_POLICY: PluginUploadPolicySnapshot = {
  maxZipBytes: 10 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFiles: 100,
  allowedContentTypes: ['application/zip'],
  blockedExtensions: ['.exe', '.dll', '.dylib', '.so', '.bin', '.app', '.pkg', '.dmg', '.iso', '.jar'],
  allowedFileExtensions: [
    '.md',
    '.txt',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.mjs',
    '.cjs',
    '.sh',
    '.bash',
    '.zsh',
    '.py',
    '.rb',
    '.php',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.swift',
    '.css',
    '.scss',
    '.html',
    '.mdx',
    '.sql',
  ],
  allowedFilenames: [
    'README',
    'README.md',
    'LICENSE',
    'NOTICE',
    'CODEOWNERS',
    'Makefile',
    'Dockerfile',
    '.env',
    '.gitignore',
    '.dockerfile',
    '.Dockerfile',
  ],
  allowedTargetPrefixes: [
    'skills/',
    'agents/',
    'hooks/',
    '.codex/',
    '.claude/',
    '.cursor/',
    '.agentrig/',
    'scripts/',
    'tools/',
  ],
  publishedVersionRetention: 10,
}

async function buildZip(entries: Array<{ path: string; content: string }>) {
  const zipWriter = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    useWebWorkers: false,
  })
  for (const entry of entries) {
    await zipWriter.add(
      entry.path,
      new Uint8ArrayReader(new TextEncoder().encode(entry.content))
    )
  }
  return zipWriter.close()
}

describe('validatePluginBundle', () => {
  it('accepts a tiny canonical bundle under the local plugin policy', async () => {
    const zipBytes = await buildZip([
      {
        path: '.plugin/plugin.json',
        content: JSON.stringify({
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          kind: 'agentrig:plugin',
          id: 'demo.test-plugin',
          name: 'Test Plugin',
          description: 'Demo plugin',
          version: '1.0.0',
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        }),
      },
      {
        path: 'README.md',
        content: '# Demo plugin\n',
      },
      {
        path: 'skills/test-plugin/SKILL.md',
        content: '# Demo skill\n',
      },
    ])

    await expect(validatePluginBundle(zipBytes, LOCAL_PLUGIN_POLICY)).resolves.toMatchObject({
      fileCount: 3,
      manifest: expect.objectContaining({
        id: 'demo.test-plugin',
      }),
    })
  })

  it('rejects user-supplied derived install metadata', async () => {
    const zipBytes = await buildZip([
      {
        path: '.plugin/plugin.json',
        content: JSON.stringify({
          $schema: 'https://agentrig.ai/schema/plugin.v1.json',
          kind: 'agentrig:plugin',
          id: 'demo.demo-plugin',
          name: 'Demo Plugin',
          description: 'Demo plugin',
          version: '1.0.0',
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        }),
      },
      {
        path: '.plugin/install.json',
        content: JSON.stringify({ files: [{ path: 'skills/demo/SKILL.md' }] }),
      },
      {
        path: 'skills/demo/SKILL.md',
        content: '# Demo skill\n',
      },
    ])

    await expect(validatePluginBundle(zipBytes, TEST_POLICY)).rejects.toEqual(
      expect.objectContaining<Partial<PluginSubmissionValidationError>>({
        errors: expect.arrayContaining([
          expect.stringMatching(/must not include \.plugin\/install\.json/i),
        ]),
      })
    )
  })
})
