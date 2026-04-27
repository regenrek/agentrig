import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'vite-plus/test',
        replacement: 'vitest',
      },
      {
        find: '@agentrig/sdk/fs-adapters/local-fs',
        replacement: path.join(rootDir, 'packages/sdk/src/fs-adapters/local-fs.ts'),
      },
      {
        find: '@agentrig/sdk/fs-adapters/zip-tree',
        replacement: path.join(rootDir, 'packages/sdk/src/fs-adapters/zip-tree.ts'),
      },
      {
        find: '@agentrig/sdk',
        replacement: path.join(rootDir, 'packages/sdk/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    include: [
      'packages/sdk/tests/**/*.test.ts',
      'packages/cli/tests/lib/**/*.test.ts',
      'packages/cli/tests/scripts/**/*.test.ts',
    ],
    // Root `pnpm exec vitest --run` is a compatibility smoke command. Full
    // package tests use `vp test`, which supports the command mock transform.
    exclude: [
      ...configDefaults.exclude,
      'packages/cli/tests/commands/**/*.test.ts',
      'packages/cli/tests/e2e/**/*.test.ts',
      'packages/cli/tests/lib/auth.test.ts',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
