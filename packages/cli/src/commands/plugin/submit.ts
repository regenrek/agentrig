import { defineCommand, showUsage } from 'citty'
import { loadAuthSession } from '../../lib/auth'
import {
  createPluginSubmission,
  getPluginSubmissionStatus,
  resolveCommunityBaseUrl,
} from '../../lib/community-api'

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
    description: 'Submit one canonical upstream plugin snapshot for review.',
  },
  args: {
    baseUrl: {
      type: 'string',
      description: 'AgentRig web base URL (defaults to stored login, AGENTRIG_BASE_URL, or https://agentrig.ai)',
    },
    upstreamRepo: {
      type: 'string',
      description: 'Canonical upstream_repo, for example https://github.com/owner/repo',
    },
    upstreamTag: {
      type: 'string',
      description: 'Canonical upstream_tag, for example v1.2.3',
    },
    upstreamCommitSha: {
      type: 'string',
      description: 'Canonical upstream_commit_sha (full 40-character commit SHA)',
    },
    pluginPath: {
      type: 'string',
      description: 'Canonical plugin_path relative to the repo root',
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
    if (!args.upstreamRepo || !args.upstreamTag || !args.upstreamCommitSha || !args.pluginPath) {
      throw new Error(
        'Canonical submission requires --upstreamRepo, --upstreamTag, --upstreamCommitSha, and --pluginPath.'
      )
    }

    const baseUrl = resolveCommunityBaseUrl(args.baseUrl, session.baseUrl)
    const created = await createPluginSubmission(baseUrl, session.accessToken, {
      upstream_repo: args.upstreamRepo,
      upstream_tag: args.upstreamTag,
      upstream_commit_sha: args.upstreamCommitSha,
      plugin_path: args.pluginPath,
    })

    console.log(`Submission: ${created.submissionId}`)
    if (created.deduped) {
      console.log('Result: existing submission reused')
    }
    const submission = await tryLoadSubmissionStatus(baseUrl, session.accessToken, created.submissionId)
    if (submission) {
      console.log(`Status: ${submission.status}`)
      console.log(`Scan status: ${submission.scanStatus}`)
    } else {
      console.log('Status: unavailable right now')
    }
    console.log('Submission recorded for validation and review')
    console.log(`Check status: agentrig plugin status ${created.submissionId}`)
  },
})

export default command
