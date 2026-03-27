import { defineCommand, showUsage } from 'citty'
import { loadAuthSession } from '../../lib/auth'
import {
  getPackSubmissionStatus,
  listPackSubmissions,
  resolveCommunityBaseUrl,
} from '../../lib/community-api'
import { selectOption } from '../../lib/interactive'

function formatSubmissionOption(submission: {
  _id: string
  status: string
  scanStatus: string
  packName?: string
  packVersion?: string
  fileName: string
  createdAt: number
}) {
  const packLabel = submission.packName
    ? `${submission.packName}${submission.packVersion ? `@${submission.packVersion}` : ''}`
    : submission.fileName
  const createdAt = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(submission.createdAt))
  return `${packLabel} [${submission.status}/${submission.scanStatus}] (${createdAt})`
}

const command = defineCommand({
  meta: {
    name: 'status',
    description: 'Show the status of a previously submitted pack upload.',
  },
  args: {
    submissionId: {
      type: 'positional',
      description: 'Submission id to inspect',
      required: false,
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
      throw new Error('Not logged in. Run `agentrig login` first.')
    }

    const baseUrl = resolveCommunityBaseUrl(args.baseUrl, session.baseUrl)
    let submissionId = args.submissionId

    if (!submissionId) {
      const submissions = await listPackSubmissions(baseUrl, session.accessToken, 20)
      if (!submissions.length) {
        console.log('No submitted packs found.')
        return
      }

      const selected = await selectOption(
        submissions,
        (submission) => formatSubmissionOption(submission),
        'Select a submission'
      )
      submissionId = selected._id
    }

    const submission = await getPackSubmissionStatus(
      baseUrl,
      session.accessToken,
      submissionId
    )

    console.log(`Submission: ${submission._id}`)
    console.log(`Status: ${submission.status}`)
    console.log(`Scan status: ${submission.scanStatus}`)
    if (submission.packName) {
      const version = submission.packVersion ? `@${submission.packVersion}` : ''
      console.log(`Pack: ${submission.packName}${version}`)
    }
    if (submission.reviewStatus) {
      console.log(`Review status: ${submission.reviewStatus}`)
    }
    if (submission.reviewNote) {
      console.log(`Review note: ${submission.reviewNote}`)
    }
    if (submission.scanWarnings?.length) {
      console.log('Warnings:')
      for (const warning of submission.scanWarnings) {
        console.log(`- ${warning}`)
      }
    }
    if (submission.scanErrors?.length) {
      console.log('Errors:')
      for (const issue of submission.scanErrors) {
        console.log(`- ${issue}`)
      }
    }
  },
})

export default command
