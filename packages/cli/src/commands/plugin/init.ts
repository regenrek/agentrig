import path from 'node:path'
import process from 'node:process'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineCommand, showUsage } from 'citty'
import { downloadTemplate } from 'giget'
import { isValidPluginName } from '../../lib/plugin-validation'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEMPLATE = 'github:regenrek/agentrig/templates/plugin-starter'
const LOCAL_TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../../../../../templates/plugin-starter'),
  path.resolve(__dirname, '../../../templates/plugin-starter'),
]
const LOCAL_TEMPLATE = LOCAL_TEMPLATE_CANDIDATES.find((candidate) => existsSync(candidate))
  ?? LOCAL_TEMPLATE_CANDIDATES[0]

/** Text file extensions for substitution (hoisted for performance) */
const TEXT_EXTENSIONS = new Set([
  '.md', '.json', '.yaml', '.yml', '.toml', '.txt',
  '.ts', '.js', '.mjs', '.sh', '.py', '.go', '.rs',
  '.html', '.css', '.xml', '.gitignore', '.editorconfig',
])

/** Special basenames that are always treated as text */
const TEXT_BASENAMES = new Set(['Justfile', 'Makefile', 'Dockerfile', 'LICENSE'])

const args = {
  name: {
    type: 'positional',
    description: 'Plugin name (will create directory)',
    required: true,
  },
  template: {
    type: 'string',
    alias: 't',
    description: 'Template source (default: github:regenrek/agentrig/templates/plugin-starter)',
  },
  dir: {
    type: 'string',
    alias: 'd',
    description: 'Parent directory (default: current directory)',
  },
  title: {
    type: 'string',
    description: 'Plugin display name (default: derived from name)',
  },
  description: {
    type: 'string',
    description: 'Plugin description',
  },
  author: {
    type: 'string',
    description: 'Plugin author',
  },
  force: {
    type: 'boolean',
    alias: 'f',
    description: 'Overwrite existing directory',
    default: false,
  },
  help: {
    type: 'boolean',
    alias: 'h',
    description: 'Show help',
    default: false,
  },
} as const

/**
 * Check if templateSpec is a GitHub source (safe for auth token).
 */
function isGitHubSource(spec: string): boolean {
  return spec.startsWith('github:') ||
    spec.startsWith('https://github.com/') ||
    spec.startsWith('gh:')
}

/**
 * Sanitize a value for use in filename substitution.
 * Removes path separators and traversal sequences.
 */
function sanitizeForFilename(value: string): string {
  return value
    .replace(/\.\./g, '') // Remove traversal sequences
    .replace(/[/\\]/g, '-') // Replace path separators with hyphen
    .replace(/[<>:"|?*\x00-\x1f]/g, '') // Remove invalid filename chars
    .trim()
}

/**
 * Validate that a destination path is within the allowed root.
 * Prevents path traversal attacks.
 */
function isPathWithinRoot(filePath: string, rootDir: string): boolean {
  const resolved = path.resolve(filePath)
  const resolvedRoot = path.resolve(rootDir)
  return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot
}

/**
 * Apply substitutions to a string.
 */
function applySubs(content: string, subs: Record<string, string>): string {
  let result = content
  for (const [key, value] of Object.entries(subs)) {
    result = result.split(key).join(value)
  }
  return result
}

/**
 * Check if a file is likely text (for substitution).
 */
function isProbablyText(filename: string): boolean {
  const basename = path.basename(filename)
  if (TEXT_BASENAMES.has(basename) || basename.startsWith('_')) return true
  const ext = path.extname(filename).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

/**
 * Recursively copy directory with substitutions.
 */
async function copyTree(
  srcDir: string,
  destDir: string,
  contentSubs: Record<string, string>,
  filenameSubs: Record<string, string>,
  rootDestDir?: string
): Promise<string[]> {
  const created: string[] = []
  const actualRootDest = rootDestDir || destDir
  await fs.mkdir(destDir, { recursive: true })

  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)

    const lstatResult = await fs.lstat(srcPath)
    if (lstatResult.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in templates: ${srcPath}`)
    }

    // Apply substitutions to filename using sanitized values
    let destName = applySubs(entry.name, filenameSubs)
    // Handle _gitignore -> .gitignore
    if (destName === '_gitignore') destName = '.gitignore'
    if (!destName || destName === '.' || destName === '..') {
      throw new Error(`Invalid destination name derived from ${entry.name}`)
    }

    const destPath = path.join(destDir, destName)
    if (!isPathWithinRoot(destPath, actualRootDest)) {
      throw new Error(`Path traversal detected: ${destPath} escapes ${actualRootDest}`)
    }

    if (entry.isDirectory()) {
      const subFiles = await copyTree(srcPath, destPath, contentSubs, filenameSubs, actualRootDest)
      created.push(...subFiles)
    } else {
      if (isProbablyText(entry.name)) {
        const content = await fs.readFile(srcPath, 'utf-8')
        await fs.writeFile(destPath, applySubs(content, contentSubs))
      } else {
        await fs.copyFile(srcPath, destPath)
      }
      // Preserve executable mode
      const stat = await fs.stat(srcPath)
      await fs.chmod(destPath, stat.mode)
      created.push(destPath)
    }
  }
  return created
}

/**
 * Check if directory exists and is not empty.
 */
async function dirHasAnyFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.length > 0
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code?: string }).code
      if (code === 'ENOENT') return false
    }
    throw err
  }
}

/**
 * Derive display name from plugin name.
 */
function deriveDisplayName(pluginName: string): string {
  const slug = pluginName.split('.').at(-1) ?? pluginName
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const command = defineCommand({
  meta: {
    name: 'init',
    description: 'Scaffold a new plugin from a template.',
  },
  args,
  async run({ args }) {
    if (args.help) return showUsage(command)

    const pluginName = args.name
    const parentDir = args.dir ? path.resolve(args.dir) : process.cwd()
    const destDir = path.join(parentDir, pluginName)

    if (!isValidPluginName(pluginName)) {
      console.error(`Invalid plugin name: ${pluginName}`)
      console.error(
        'Plugin names must be 1-64 lowercase letters, numbers, dots, or hyphens; start and end alphanumeric; and not contain "--" or "..".'
      )
      process.exit(1)
    }

    // Check destination
    let destHasFiles = false
    try {
      destHasFiles = await dirHasAnyFiles(destDir)
    } catch (err) {
      console.error(`Unable to read destination directory: ${destDir}`)
      console.error((err as Error).message)
      process.exit(1)
    }

    if (destHasFiles) {
      if (!args.force) {
        console.error(`Directory already exists and is not empty: ${destDir}`)
        console.error('Use --force to overwrite.')
        process.exit(1)
      }
      await fs.rm(destDir, { recursive: true, force: true })
    }

    const templateSpec = args.template || DEFAULT_TEMPLATE
    const pluginSlug = pluginName.split('.').at(-1) ?? pluginName
    const displayName = args.title || deriveDisplayName(pluginName)
    const description = args.description || `${displayName} plugin for AgentRig`
    const author = args.author || ''

    // Substitution map
    const contentSubs: Record<string, string> = {
      '__PLUGIN_ID__': pluginName,
      '__PLUGIN_SLUG__': pluginSlug,
      '__PLUGIN_NAME__': displayName,
      '__PLUGIN_DESCRIPTION__': description,
      '__PLUGIN_AUTHOR__': author,
      '__YEAR__': new Date().getFullYear().toString(),
    }
    const filenameSubs: Record<string, string> = {}
    for (const [key, value] of Object.entries(contentSubs)) {
      filenameSubs[key] = sanitizeForFilename(value)
    }

    console.log(`Scaffolding plugin "${pluginName}" from ${templateSpec}...`)

    // Determine template source
    let templateRoot: string
    let tempDir: string | null = null

    // Check if using local template
    if (templateSpec.startsWith('file:') || templateSpec === 'local') {
      const localPath = templateSpec === 'local'
        ? LOCAL_TEMPLATE
        : templateSpec.replace(/^file:/, '')
      templateRoot = path.join(localPath, 'template')
      try {
        await fs.stat(templateRoot)
      } catch {
        templateRoot = localPath
      }
    } else {
      // Download from remote
      tempDir = await fs.mkdtemp(path.join(tmpdir(), 'agentrig-plugin-'))
      try {
        const token = String(
          process.env['GITHUB_TOKEN'] || process.env['AGENTRIG_TEMPLATE_TOKEN'] || ''
        ).trim()
        const downloaded = await downloadTemplate(templateSpec, {
          dir: tempDir ?? undefined,
          force: true,
          auth: isGitHubSource(templateSpec) && token ? token : undefined,
        })
        templateRoot = downloaded.dir

        // Check for template subdirectory
        const maybeTemplate = path.join(templateRoot, 'template')
        try {
          const templateStat = await fs.stat(maybeTemplate)
          if (templateStat.isDirectory()) {
            templateRoot = maybeTemplate
          }
        } catch {
          // no template subdir, use as-is
        }
      } catch (err) {
        // Fallback to local template if remote fails
        console.log('Remote template failed, using local fallback...')
        if (tempDir) {
          await fs.rm(tempDir, { recursive: true, force: true })
          tempDir = null
        }
        templateRoot = path.join(LOCAL_TEMPLATE, 'template')
        try {
          await fs.stat(templateRoot)
        } catch {
          console.error(`Local template not found at ${templateRoot}`)
          process.exit(1)
        }
      }
    }

    try {
      // Copy with substitutions
      await fs.mkdir(destDir, { recursive: true })
      const created = await copyTree(templateRoot, destDir, contentSubs, filenameSubs, destDir)

      console.log(`\nCreated ${created.length} file(s) in ${destDir}`)
      console.log('\nNext steps:')
      console.log(`  cd ${pluginName}`)
      console.log('  # Edit plugin.json and add optional agents/hooks/scripts directories if needed')
      console.log('  agentrig plugin bundle .')
      console.log('  cd ..')
      console.log(`  agentrig plugin export --agent all --pluginsDir ./${pluginName} --out dist/plugins`)
    } finally {
      // Cleanup temp dir if used
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    }
  },
})

export default command
