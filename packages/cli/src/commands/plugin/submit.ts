import { defineCommand, showUsage } from 'citty'
import path from 'node:path'
import process from 'node:process'
import { loadAuthSession } from '../../lib/auth'
import {
  createPluginSubmission,
  getPluginSubmissionStatus,
  mintPublishToken,
  resolveCommunityBaseUrl,
} from '../../lib/community-api'
import { readJsonFile } from '../../lib/fs'
import {
  hasGitHubActionsOidcEnv,
  requestGitHubActionsOidcToken,
} from '../../lib/github-actions-oidc'
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

function defaultGitHubRepo() {
  const repository = process.env.GITHUB_REPOSITORY?.trim()
  if (!repository) return undefined
  const serverUrl = process.env.GITHUB_SERVER_URL?.trim() || 'https://github.com'
  return `${serverUrl.replace(/\/$/, '')}/${repository}`
}

function defaultGitHubRef() {
  return process.env.GITHUB_REF_NAME?.trim() || process.env.GITHUB_REF?.trim() || undefined
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
      description: 'Canonical plugin_path relative to the repo root (defaults to . for trusted publishing)',
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

    const pluginPath = optionalArg(args.pluginPath) ?? (trustedPublish ? '.' : undefined)
    const upstreamRepo = optionalArg(args.upstreamRepo) ?? (trustedPublish ? defaultGitHubRepo() : undefined)
    const upstreamTag = optionalArg(args.upstreamTag) ?? (trustedPublish ? defaultGitHubRef() : undefined)
    const upstreamCommitSha = optionalArg(args.upstreamCommitSha) ?? (trustedPublish ? process.env.GITHUB_SHA?.trim() : undefined)
    if (!upstreamRepo || !upstreamTag || !upstreamCommitSha || !pluginPath) {
      throw new Error(
        'Canonical submission requires upstream repo, ref, commit SHA, and plugin path. Pass flags or run trusted publishing inside GitHub Actions.'
      )
    }

    const baseUrl = resolveCommunityBaseUrl(optionalArg(args.baseUrl), session?.baseUrl)
    const payload = {
      upstream_repo: upstreamRepo,
      upstream_tag: upstreamTag,
      upstream_commit_sha: upstreamCommitSha,
      plugin_path: pluginPath,
    }

    if (args.dryRun) {
      console.log('Publish shape: plugin_all')
      if (trustedPublish) console.log('Trusted publisher: GitHub Actions OIDC')
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    const manifest = trustedPublish ? await readLocalPluginManifest(pluginPath) : null
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
          commitSha: upstreamCommitSha,
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
