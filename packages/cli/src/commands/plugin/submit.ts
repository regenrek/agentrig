import path from 'node:path'
import process from 'node:process'
import { defineCommand, showUsage } from 'citty'
import { loadAuthSession } from '../../lib/auth'
import {
  createPluginSubmission,
  getPluginSubmissionStatus,
  getPluginUploadPolicy,
  getPluginUploadUrl,
  resolveCommunityBaseUrl,
  uploadPluginBundle,
} from '../../lib/community-api'
import { createPluginBundle, removePluginBundle } from '../../lib/plugin-bundle'
import {
  formatPluginValidationMessages,
  PluginSubmissionValidationError,
  validatePluginBundle,
} from '../../lib/plugin-submission-validation'

const STATUS_LOOKUP_MAX_ATTEMPTS = 3
const STATUS_LOOKUP_RETRY_MS = 50

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function tryLoadSubmissionStatus(
  baseUrl: string,
  accessToken: string,
  submissionId: string
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= STATUS_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await getPluginSubmissionStatus(baseUrl, accessToken, submissionId)
    } catch (error) {
      lastError = error
      if (attempt < STATUS_LOOKUP_MAX_ATTEMPTS) {
        await sleep(STATUS_LOOKUP_RETRY_MS * attempt)
      }
    }
  }

  console.warn(
    `Unable to fetch submission status right now: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
  return null
}

const command = defineCommand({
  meta: {
    name: 'submit',
    description: 'Bundle a plugin, upload it, and submit it for review.',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Plugin directory to submit (defaults to current directory)',
      required: false,
    },
    baseUrl: {
      type: 'string',
      description: 'AgentRig web base URL (defaults to stored login, AGENTRIG_BASE_URL, or https://agentrig.ai)',
    },
    'keep-bundle': {
      type: 'boolean',
      description: 'Keep the generated ZIP on disk after submit',
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
    const policy = await getPluginUploadPolicy(baseUrl, session.accessToken)

    const bundle = await createPluginBundle({
      dir: directory,
      policy,
      temporary: !args['keep-bundle'],
    })

    try {
      const validation = await validatePluginBundle(bundle.zipBytes, policy)
      if (validation.warnings.length) {
        console.log('Warnings:')
        for (const warning of validation.warnings) {
          console.log(`- ${warning}`)
        }
      }

      const uploadUrl = await getPluginUploadUrl(baseUrl, session.accessToken)
      const storageId = await uploadPluginBundle(uploadUrl, bundle.zipBytes)
      const submissionId = await createPluginSubmission(baseUrl, session.accessToken, {
        storageId,
        fileName: bundle.fileName,
        fileSize: bundle.zipBytes.length,
        contentType: 'application/zip',
      })

      console.log(`Submission: ${submissionId}`)
      const submission = await tryLoadSubmissionStatus(baseUrl, session.accessToken, submissionId)
      if (submission) {
        console.log(`Status: ${submission.status}`)
      } else {
        console.log('Status: unavailable right now')
      }
      console.log('Submitted, waiting for review')
      console.log(`Check status: agentrig plugin status ${submissionId}`)
      if (args['keep-bundle']) {
        console.log(`Bundle kept at: ${bundle.bundlePath}`)
      }
    } catch (error) {
      if (error instanceof PluginSubmissionValidationError) {
        const warningBlock = error.warnings.length
          ? `\nWarnings:\n${formatPluginValidationMessages(error.warnings)}`
          : ''
        throw new Error(
          `Plugin submit failed local validation:\n${formatPluginValidationMessages(error.errors)}${warningBlock}`
        )
      }
      throw error
    } finally {
      await removePluginBundle(bundle)
    }
  },
})

export default command
