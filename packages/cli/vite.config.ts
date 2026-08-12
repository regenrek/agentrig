import { defineConfig } from 'vite-plus'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@agentrig/sdk/agent-plugin-package-fs',
        replacement: '../../packages/sdk/src/agent-plugin-package-fs.ts',
      },
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
  pack: {
    clean: true,
    deps: {
      alwaysBundle: ['@agentrig/sdk'],
    },
    dts: true,
    entry: ['./src/cli.ts'],
    format: ['esm'],
    minify: false,
    outDir: './dist',
    platform: 'node',
    sourcemap: true,
    target: 'node18',
  },
})
