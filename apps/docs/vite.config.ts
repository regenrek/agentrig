import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import alchemy from 'alchemy/cloudflare/tanstack-start'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'

export default defineConfig({
  server: {
    port: 5173,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: [
      'fumadocs-mdx:collections/browser',
      'fumadocs-mdx:collections/server',
    ],
  },
  ssr: {
    noExternal: ['fumadocs-ui', 'fumadocs-core', 'fumadocs-mdx'],
  },
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    alchemy(),
    tanstackStart({
      prerender: {
        enabled: true,
        routes: ['/', '/docs'],
      },
    }),
    Icons({
      compiler: 'jsx',
      jsx: 'react',
      autoInstall: false,
    }),
    react(),
  ],
})
