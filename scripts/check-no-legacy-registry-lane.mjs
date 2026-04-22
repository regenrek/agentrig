import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const outputTrees = [
  path.join(repoRoot, 'public', 'registry'),
  path.join(repoRoot, 'apps', 'docs', 'public', 'registry'),
  path.resolve(repoRoot, '..', 'agentrig-web', 'public', 'registry'),
]

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function collectEntries(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const results = []

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/')
    results.push(relativePath)
    if (entry.isDirectory()) {
      results.push(...(await collectEntries(rootDir, absolutePath)))
    }
  }

  return results
}

function isLegacyRegistryEntry(relativePath) {
  return (
    relativePath === 'registry.v1.json' ||
    relativePath === 'manifests' ||
    relativePath.startsWith('manifests/') ||
    relativePath === '.plugin/install.json' ||
    relativePath.endsWith('/.plugin/install.json')
  )
}

async function main() {
  const violations = []

  for (const outputTree of outputTrees) {
    if (!(await pathExists(outputTree))) {
      continue
    }

    const entries = await collectEntries(outputTree)
    for (const relativePath of entries) {
      if (!isLegacyRegistryEntry(relativePath)) {
        continue
      }
      violations.push(`${path.relative(repoRoot, outputTree)} :: ${relativePath}`)
    }
  }

  if (violations.length > 0) {
    throw new Error(
      [
        'Legacy registry output is forbidden.',
        'Remove registry.v1.json, manifests/, and .plugin/install.json from derived web output trees.',
        ...violations.map((violation) => `- ${violation}`),
      ].join('\n'),
    )
  }

  console.log('Verified no legacy registry lane exists in derived web output trees.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
