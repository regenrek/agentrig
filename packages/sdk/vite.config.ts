import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    clean: true,
    dts: true,
    entry: ['./src/index.ts', './src/fs-adapters/local-fs.ts', './src/fs-adapters/zip-tree.ts'],
    format: ['esm'],
    minify: false,
    outDir: './dist',
    platform: 'node',
    sourcemap: true,
    target: 'node18',
  },
})
