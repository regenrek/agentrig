import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadAuthSession } from '../../lib/auth'
import { getPackUploadPolicy, resolveCommunityBaseUrl } from '../../lib/community-api'
import { removeIfExists } from '../../lib/fs'
import { createPackBundle } from '../../lib/pack-bundle'
import {
  formatPackValidationMessages,
  PackPublishValidationError,
  validatePackBundle,
} from '../../lib/pack-publish-validation'

const command = defineCommand({
  meta: {
    name: 'bundle',
    description: 'Build a ZIP bundle and validate it against the hosted AgentRig upload policy.',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Pack directory to bundle (defaults to current directory)',
      required: false,
    },
    out: {
      type: 'string',
      description: 'Output ZIP path (defaults to <pack-dir>/<pack-name>-<version>.zip)',
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
    const policy = await getPackUploadPolicy(baseUrl, session.accessToken)

    const bundle = await createPackBundle({
      dir: directory,
      policy,
      outFile: args.out ? path.resolve(args.out) : undefined,
      temporary: false,
    })

    try {
      const validation = await validatePackBundle(bundle.zipBytes, policy)
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
      if (error instanceof PackPublishValidationError) {
        const warningBlock = error.warnings.length
          ? `\nWarnings:\n${formatPackValidationMessages(error.warnings)}`
          : ''
        throw new Error(
          `Pack bundle failed validation:\n${formatPackValidationMessages(error.errors)}${warningBlock}`
        )
      }
      throw error
    }
  },
})

export default command
