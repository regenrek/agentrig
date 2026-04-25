import { listVirtualFiles, normalizeVirtualPath, type VirtualTree } from '../repo-scan/virtual-tree'

export type PluginFeatures = {
  hasReadme: boolean
  hasSkills: boolean
  hasCommands: boolean
  hasAgents: boolean
  hasRules: boolean
  hasHooks: boolean
  hasAssets: boolean
  hasScripts: boolean
  hasSettings: boolean
  hasClaudeMcp: boolean
  hasClaudeLsp: boolean
  hasCodexApp: boolean
}

export async function detectPluginFeatures(tree: VirtualTree): Promise<PluginFeatures> {
  const files = await listVirtualFiles(tree)
  const paths = new Set(files.map((file) => normalizeVirtualPath(file.path)))
  const directories = new Set<string>()

  for (const file of files) {
    const parts = file.path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }

  const hasPath = (path: string) =>
    paths.has(normalizeVirtualPath(path)) || directories.has(normalizeVirtualPath(path))

  return {
    hasReadme: hasPath('README.md'),
    hasSkills: hasPath('skills'),
    hasCommands: hasPath('commands'),
    hasAgents: hasPath('agents'),
    hasRules: hasPath('rules'),
    hasHooks: hasPath('hooks/hooks.json'),
    hasAssets: hasPath('assets'),
    hasScripts: hasPath('scripts'),
    hasSettings: hasPath('settings.json'),
    hasClaudeMcp: hasPath('.mcp.json') || hasPath('mcp.json'),
    hasClaudeLsp: hasPath('.lsp.json'),
    hasCodexApp: hasPath('.app.json'),
  }
}
