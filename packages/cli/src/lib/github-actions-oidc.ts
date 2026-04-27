import process from 'node:process'

const DEFAULT_AUDIENCE = 'agentrig'

export function hasGitHubActionsOidcEnv(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
}

export async function requestGitHubActionsOidcToken(
  audience = DEFAULT_AUDIENCE,
  env: NodeJS.ProcessEnv = process.env
) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!requestUrl || !requestToken) {
    throw new Error('GitHub Actions OIDC env is missing. Configure permissions: id-token: write.')
  }

  const url = new URL(requestUrl)
  url.searchParams.set('audience', audience)
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${requestToken}`,
      accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub Actions OIDC token request failed (${response.status}).`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const value = body.value
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('GitHub Actions OIDC response did not include a token value.')
  }
  return value.trim()
}
