import { defineCommand, showUsage } from 'citty'
import { clearAuthSession, loadAuthSession } from '../lib/auth'
import { CommunityApiError, logout as logoutRequest, resolveCommunityBaseUrl } from '../lib/community-api'

const command = defineCommand({
  meta: {
    name: 'logout',
    description: 'Revoke the stored AgentRig CLI access token.',
  },
  args: {
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
      console.log('Not logged in.')
      return
    }

    const baseUrl = resolveCommunityBaseUrl(args.baseUrl, session.baseUrl)
    try {
      await logoutRequest(baseUrl, session.accessToken)
    } catch (error) {
      if (!(error instanceof CommunityApiError) || error.status !== 401) {
        throw error
      }
    }

    await clearAuthSession()
    console.log('Logged out.')
  },
})

export default command
