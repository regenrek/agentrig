import { defineCommand, showUsage } from 'citty'
import path from 'node:path'
import process from 'node:process'
import { loadAuthSession } from '../../lib/auth'
import {
  createPluginSubmission,
  getPluginSubmissionStatus,
  mintPublishToken,
  resolveAuthenticatedCommunityBaseUrl,
  resolveCommunityBaseUrl,
} from '../../lib/community-api'
import { readJsonFile } from '../../lib/fs'
import {
  hasGitHubActionsOidcEnv,
  requestGitHubActionsOidcToken,
} from '../../lib/github-actions-oidc'
import { resolveSubmitSource } from '../../lib/submit-source'
import type { PluginManifest } from '../../lib/types'

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

function optionalArg(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function defaultTrustedSource() {
  const repository = process.env.GITHUB_REPOSITORY?.trim()
  if (!repository) return undefined
  const ref = process.env.GITHUB_REF_NAME?.trim() || process.env.GITHUB_REF?.trim()
  return ref ? `${repository}@${ref}` : repository
}

async function readLocalPluginManifest(pluginPath: string) {
  const manifestPath = path.resolve(process.cwd(), pluginPath, '.plugin', 'plugin.json')
  return await readJsonFile<PluginManifest>(manifestPath)
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
    source: {
      type: 'positional',
      description: 'Local plugin path, GitHub owner/repo@tag, or GitHub URL',
    },
    version: {
      type: 'string',
      description: 'Plugin version used to resolve v<version> or <version> tags when the source has no tag',
    },
    path: {
      type: 'string',
      description: 'Plugin path inside the source repo when it cannot be inferred from the source',
    },
    artifactId: {
      type: 'string',
      description: 'Plugin artifact id for trusted publishing (defaults to .plugin/plugin.json id)',
    },
    trustedPublish: {
      type: 'boolean',
      description: 'Use GitHub Actions OIDC trusted publishing instead of a stored AgentRig login.',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Print the canonical submit payload without creating a review request.',
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
    const trustedPublish = Boolean(args.trustedPublish) || (!session && hasGitHubActionsOidcEnv())
    if (!session && !trustedPublish) {
      throw new Error('Not logged in. Run `agentrig login` first or run from GitHub Actions with id-token: write.')
    }
    if (trustedPublish && !hasGitHubActionsOidcEnv()) {
      throw new Error('Trusted publishing requires GitHub Actions OIDC env. Configure permissions: id-token: write.')
    }

    const source = optionalArg(args.source) ?? (trustedPublish ? defaultTrustedSource() : undefined)
    if (!source) throw new Error('Submit source required. Use a local path, owner/repo@tag, or GitHub URL.')

    const baseUrl = trustedPublish
      ? resolveCommunityBaseUrl(optionalArg(args.baseUrl), session?.baseUrl)
      : resolveAuthenticatedCommunityBaseUrl(optionalArg(args.baseUrl), session!.baseUrl)
    const payload = await resolveSubmitSource({
      source,
      version: optionalArg(args.version),
      path: optionalArg(args.path),
      expectedCommitSha: trustedPublish ? optionalArg(process.env.GITHUB_SHA) : undefined,
    })

    if (args.dryRun) {
      console.log('Publish shape: plugin_all')
      if (trustedPublish) console.log('Trusted publisher: GitHub Actions OIDC')
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    const manifest = trustedPublish ? await readLocalPluginManifest(payload.plugin_path) : null
    const artifactId = optionalArg(args.artifactId) ?? manifest?.id
    if (trustedPublish && !artifactId) {
      throw new Error('Trusted publishing requires --artifactId or a readable .plugin/plugin.json with an id.')
    }
    const accessToken = trustedPublish
      ? (await mintPublishToken(baseUrl, {
          artifactKind: 'plugin',
          artifactId: artifactId as string,
          version: manifest?.version,
          publishShape: { kind: 'plugin_all' },
          commitSha: payload.upstream_commit_sha,
          githubOidcToken: await requestGitHubActionsOidcToken(),
        })).token
      : session?.accessToken
    if (!accessToken) throw new Error('Missing AgentRig submission token.')

    const created = await createPluginSubmission(baseUrl, accessToken, payload)

    console.log(`Submission: ${created.submissionId}`)
    console.log('Publish shape: plugin_all')
    if (trustedPublish) {
      console.log('Trusted publisher: GitHub Actions OIDC')
    }
    if (created.deduped) {
      console.log('Result: existing submission reused')
    }
    const submission = !trustedPublish && session
      ? await tryLoadSubmissionStatus(baseUrl, session.accessToken, created.submissionId)
      : null
    if (submission) {
      console.log(`Status: ${submission.status}`)
      console.log(`Scan status: ${submission.scanStatus}`)
    } else if (trustedPublish) {
      console.log('Status: queued for validation and review')
    } else {
      console.log('Status: unavailable right now')
    }
    console.log('Submission recorded for validation and review')
    console.log(`Check status: agentrig plugin status ${created.submissionId}`)
  },
})

export default command
