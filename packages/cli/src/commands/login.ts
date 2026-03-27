import { defineCommand, showUsage } from 'citty'
import { openExternalUrl } from '../lib/browser'
import { resolveCommunityBaseUrl, startCliLogin, exchangeCliLogin } from '../lib/community-api'
import { saveAuthSession } from '../lib/auth'

const LOGIN_POLL_INTERVAL_MS = 2000

const command = defineCommand({
  meta: {
    name: 'login',
    description: 'Log in to agentrig.ai in your browser and store a CLI access token.',
  },
  args: {
    baseUrl: {
      type: 'string',
      description: 'AgentRig web base URL (defaults to AGENTRIG_BASE_URL or https://agentrig.ai)',
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

    const baseUrl = resolveCommunityBaseUrl(args.baseUrl)
    const login = await startCliLogin(baseUrl)
    const opened = await openExternalUrl(login.verificationUrl)

    console.log(`Login code: ${login.publicCode}`)
    if (opened) {
      console.log(`Opened browser: ${login.verificationUrl}`)
    } else {
      console.log(`Open this URL in your browser: ${login.verificationUrl}`)
    }
    console.log('Waiting for browser approval...')

    const deadline = login.expiresAt
    while (Date.now() < deadline) {
      const exchange = await exchangeCliLogin(baseUrl, login.requestId, login.exchangeSecret)
      if (exchange.status === 'approved') {
        await saveAuthSession({
          baseUrl,
          accessToken: exchange.accessToken,
          expiresAt: exchange.expiresAt,
          userId: exchange.user.userId,
          email: exchange.user.email,
          name: exchange.user.name,
        })
        const label = exchange.user.name ?? exchange.user.email ?? exchange.user.userId
        console.log(`eingeloggt als ${label}`)
        return
      }
      if (exchange.status === 'expired') {
        throw new Error('CLI login request expired. Run `agentrig login` again.')
      }
      await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_INTERVAL_MS))
    }

    throw new Error('CLI login timed out. Run `agentrig login` again.')
  },
})

export default command
