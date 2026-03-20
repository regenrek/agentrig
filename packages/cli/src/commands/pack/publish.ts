import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadAuthSession } from '../../lib/auth'
import {
  createPackSubmission,
  getPackSubmissionStatus,
  getPackUploadPolicy,
  getPackUploadUrl,
  resolveCommunityBaseUrl,
  uploadPackBundle,
} from '../../lib/community-api'
import { createPackBundle, removePackBundle } from '../../lib/pack-bundle'
import {
  formatPackValidationMessages,
  PackPublishValidationError,
  validatePackBundle,
} from '../../lib/pack-publish-validation'

const command = defineCommand({
  meta: {
    name: 'publish',
    description: 'Bundle a pack, upload it, and submit it for review.',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Pack directory to publish (defaults to current directory)',
      required: false,
    },
    baseUrl: {
      type: 'string',
      description: 'AgentRig web base URL (defaults to stored login, AGENTRIG_BASE_URL, or https://agentrig.ai)',
    },
    'keep-bundle': {
      type: 'boolean',
      description: 'Keep the generated ZIP on disk after publish',
      default: false,
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
      throw new Error('Not logged in. Run `agentrig login` first.')
    }

    const directory = path.resolve(args.dir ?? process.cwd())
    const baseUrl = resolveCommunityBaseUrl(args.baseUrl, session.baseUrl)
    const policy = await getPackUploadPolicy(baseUrl, session.accessToken)

    const bundle = await createPackBundle({
      dir: directory,
      policy,
      temporary: !args['keep-bundle'],
    })

    try {
      const validation = await validatePackBundle(bundle.zipBytes, policy)
      if (validation.warnings.length) {
        console.log('Warnings:')
        for (const warning of validation.warnings) {
          console.log(`- ${warning}`)
        }
      }

      const uploadUrl = await getPackUploadUrl(baseUrl, session.accessToken)
      const storageId = await uploadPackBundle(uploadUrl, bundle.zipBytes)
      const submissionId = await createPackSubmission(baseUrl, session.accessToken, {
        storageId,
        fileName: bundle.fileName,
        fileSize: bundle.zipBytes.length,
        contentType: 'application/zip',
      })
      const submission = await getPackSubmissionStatus(baseUrl, session.accessToken, submissionId)

      console.log(`Submission: ${submissionId}`)
      console.log(`Status: ${submission.status}`)
      console.log('submitted, waiting for review')
      console.log(`Check status: agentrig pack status ${submissionId}`)
      if (args['keep-bundle']) {
        console.log(`Bundle kept at: ${bundle.bundlePath}`)
      }
    } catch (error) {
      if (error instanceof PackPublishValidationError) {
        const warningBlock = error.warnings.length
          ? `\nWarnings:\n${formatPackValidationMessages(error.warnings)}`
          : ''
        throw new Error(
          `Pack publish failed local validation:\n${formatPackValidationMessages(error.errors)}${warningBlock}`
        )
      }
      throw error
    } finally {
      await removePackBundle(bundle)
    }
  },
})

export default command
