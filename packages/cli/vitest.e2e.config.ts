import { defineConfig } from 'vite-plus/test/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@agentrig/sdk/fs-adapters/local-fs',
        replacement: '../../packages/sdk/src/fs-adapters/local-fs.ts',
      },
      {
        find: '@agentrig/sdk',
        replacement: '../../packages/sdk/src/index.ts',
      },
    ],
  },
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: Number.parseInt(process.env.AGENTRIG_REAL_REPO_TEST_TIMEOUT_MS ?? '180000', 10),
    hookTimeout: Number.parseInt(process.env.AGENTRIG_REAL_REPO_TEST_TIMEOUT_MS ?? '180000', 10),
    fileParallelism: false,
  },
})
