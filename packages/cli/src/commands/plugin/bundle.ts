import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadAuthSession } from '../../lib/auth'
import { getPluginUploadPolicy, resolveCommunityBaseUrl } from '../../lib/community-api'
import { removeIfExists } from '../../lib/fs'
import { createPluginBundle } from '../../lib/plugin-bundle'
import {
  formatPluginValidationMessages,
  PluginSubmissionValidationError,
  validatePluginBundle,
} from '../../lib/plugin-submission-validation'

const command = defineCommand({
  meta: {
    name: 'bundle',
    description: 'Build a plugin ZIP bundle and validate it against the hosted AgentRig upload policy.',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Plugin directory to bundle (defaults to current directory)',
      required: false,
    },
    out: {
      type: 'string',
      description: 'Output ZIP path (defaults to <plugin-dir>/<plugin-id>-<version>.zip)',
    },
    baseUrl: {
      type: 'string',
      description: 'AgentRig web base URL (defaults to stored login, AGENTRIG_BASE_URL, or https://agentrig.ai)',
    },
    help: {
      type: 'boolean',
      alias: 'h',
      description: 'Show help',
      default: false,
    },
  },
  async run({ args }) {
    if (args.help) return showUsage(command)

    const session = await loadAuthSession()
    if (!session) {
      throw new Error(
        'Not logged in. Run `agentrig login` first so the CLI can fetch the hosted upload policy.'
      )
    }

    const directory = path.resolve(args.dir ?? process.cwd())
    const baseUrl = resolveCommunityBaseUrl(args.baseUrl, session.baseUrl)
    const policy = await getPluginUploadPolicy(baseUrl, session.accessToken)

    const bundle = await createPluginBundle({
      dir: directory,
      policy,
      outFile: args.out ? path.resolve(args.out) : undefined,
      temporary: false,
    })

    try {
      const validation = await validatePluginBundle(bundle.zipBytes, policy)
      if (validation.warnings.length) {
        console.log('Warnings:')
        for (const warning of validation.warnings) {
          console.log(`- ${warning}`)
        }
      }
      console.log(`Bundle ready: ${bundle.bundlePath}`)
      console.log(`Files: ${validation.fileCount}`)
      console.log(`ZIP size: ${validation.zipBytes} bytes`)
    } catch (error) {
      await removeIfExists(bundle.bundlePath)
      if (error instanceof PluginSubmissionValidationError) {
        const warningBlock = error.warnings.length
          ? `\nWarnings:\n${formatPluginValidationMessages(error.warnings)}`
          : ''
        throw new Error(
          `Plugin bundle failed validation:\n${formatPluginValidationMessages(error.errors)}${warningBlock}`
        )
      }
      throw error
    }
  },
})

export default command
