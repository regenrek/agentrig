import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vite-plus/test'

describe('SDK runtime boundaries', () => {
  it('keeps filesystem inspection out of the runtime-neutral root export', async () => {
    const [rootSource, packageJsonSource] = await Promise.all([
      readFile(new URL('./index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ])
    const packageJson = JSON.parse(packageJsonSource) as { exports?: Record<string, unknown> }

    expect(rootSource).not.toContain("export * from './agent-plugin-package-fs'")
    expect(packageJson.exports).toHaveProperty('./agent-plugin-package-fs')
  })
})
