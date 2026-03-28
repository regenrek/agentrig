import { configDefaults, defineConfig } from 'vite-plus/test/config'

export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    exclude: [...configDefaults.exclude, 'tests/e2e/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts'],
      thresholds: {
        global: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  },
})
