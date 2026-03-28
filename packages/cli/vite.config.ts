import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    clean: true,
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
