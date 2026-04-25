import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    cache: false,
    tasks: {
      'repo:dev:cli': {
        command: 'tsx src/cli.ts',
        cwd: 'packages/cli',
      },
      'repo:typecheck:cli': {
        command: 'tsc -p tsconfig.json --noEmit',
        cwd: 'packages/cli',
      },
      'repo:typecheck:sdk': {
        command: 'tsc -p tsconfig.json --noEmit',
        cwd: 'packages/sdk',
      },
      'repo:build:sdk': {
        command: 'vp pack',
        cwd: 'packages/sdk',
      },
      'repo:build:cli': {
        command: 'vp pack',
        cwd: 'packages/cli',
      },
      'repo:plugins:build': {
        command: 'tsx src/cli.ts pack plugin export --agent all',
        cwd: 'packages/cli',
      },
      'repo:plugins:build:claude': {
        command: 'tsx src/cli.ts pack plugin export --agent claude',
        cwd: 'packages/cli',
      },
      'repo:coverage': {
        command: 'vp test --run --coverage',
        cwd: 'packages/cli',
      },
      'repo:docs:dev': {
        command: 'alchemy dev',
        cwd: 'apps/docs',
      },
      'repo:docs:build': {
        command: 'vite build',
        cwd: 'apps/docs',
      },
      'repo:playground:vite-plus:check': {
        command: 'node scripts/vite-plus-playground.mjs --check',
      },
      'repo:playground:vite-plus:refresh': {
        command: 'node scripts/vite-plus-playground.mjs --write',
      },
      'repo:test': {
        command: 'vp test --run',
        cwd: 'packages/cli',
      },
      'repo:test:sdk': {
        command: 'vp test --run',
        cwd: 'packages/sdk',
      },
      'repo:test:e2e': {
        command: 'vp pack && vp test --run --config vitest.e2e.config.ts',
        cwd: 'packages/cli',
      },
      'repo:test:release:local': {
        command: 'node scripts/test-release-local.mjs',
      },
      'repo:test:release:smoke': {
        command: 'node scripts/test-release-local.mjs --smoke-only',
      },
      'repo:check': {
        command: 'vp run repo:typecheck:cli',
        dependsOn: ['repo:typecheck:sdk', 'repo:test', 'repo:test:sdk', 'repo:playground:vite-plus:check'],
      },
    },
  },
})
