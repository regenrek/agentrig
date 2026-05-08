const EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
])

const EXCLUDED_FILES = new Set([
  'bun.lockb',
  'Cargo.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])

export function shouldIncludeRepoScanPath(path: string) {
  const segments = path.split('/')
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return false
  const basename = segments[segments.length - 1] ?? ''
  return !EXCLUDED_FILES.has(basename)
}
