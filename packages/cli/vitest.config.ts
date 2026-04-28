import { configDefaults, defineConfig } from 'vite-plus/test/config'

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
    testTimeout: 20_000,
    hookTimeout: 20_000,
    exclude: [...configDefaults.exclude, 'tests/e2e/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts'],
      // Current release baseline. Raise these values as CLI coverage improves.
      thresholds: {
        lines: 54,
        functions: 54,
        branches: 42,
        statements: 52,
      },
    },
  },
})
