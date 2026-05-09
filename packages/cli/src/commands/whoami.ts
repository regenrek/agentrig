import { defineCommand, showUsage } from 'citty'
import { clearAuthSession, loadAuthSession } from '../lib/auth'
import { CommunityApiError, resolveAuthenticatedCommunityBaseUrl, whoAmI } from '../lib/community-api'

const command = defineCommand({
  meta: {
    name: 'whoami',
    description: 'Show the AgentRig account currently logged into the CLI.',
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
      throw new Error('Not logged in. Run `agentrig login` first.')
    }

    const baseUrl = resolveAuthenticatedCommunityBaseUrl(args.baseUrl, session.baseUrl)

    try {
      const result = await whoAmI(baseUrl, session.accessToken)
      const label = result.name ?? result.email ?? result.userId
      console.log(`eingeloggt als ${label}`)
    } catch (error) {
      if (error instanceof CommunityApiError && error.status === 401) {
        await clearAuthSession()
        throw new Error('Stored CLI login is no longer valid. Run `agentrig login` again.')
      }
      throw error
    }
  },
})

export default command
