import { defineConfig } from 'vite-plus/test/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: Number.parseInt(process.env.AGENTRIG_REAL_REPO_TEST_TIMEOUT_MS ?? '180000', 10),
    hookTimeout: Number.parseInt(process.env.AGENTRIG_REAL_REPO_TEST_TIMEOUT_MS ?? '180000', 10),
    fileParallelism: false,
  },
})
