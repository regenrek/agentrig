import { chmodIfPossible, readJsonFile, removeIfExists, writeJsonFile } from './fs'
import { getGlobalAuthPath } from './config'
import type { CliAuthSession } from './types'

function assertString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Stored CLI auth is invalid: ${field} is required`)
  }
  return value.trim()
}

function assertOptionalString(value: unknown) {
  if (value == null) return undefined
  if (typeof value !== 'string') {
    throw new Error('Stored CLI auth is invalid: optional fields must be strings')
  }
  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function assertNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Stored CLI auth is invalid: ${field} must be a number`)
  }
  return value
}

function parseAuthSession(raw: unknown): CliAuthSession {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Stored CLI auth is invalid')
  }
  const value = raw as Record<string, unknown>
  return {
    baseUrl: assertString(value.baseUrl, 'baseUrl'),
    accessToken: assertString(value.accessToken, 'accessToken'),
    expiresAt: assertNumber(value.expiresAt, 'expiresAt'),
    userId: assertString(value.userId, 'userId'),
    email: assertOptionalString(value.email),
    name: assertOptionalString(value.name),
  }
}

export async function loadAuthSession() {
  const authPath = getGlobalAuthPath()
  const raw = await readJsonFile<unknown>(authPath)
  if (!raw) return null
  return parseAuthSession(raw)
}

export async function saveAuthSession(session: CliAuthSession) {
  const authPath = getGlobalAuthPath()
  await writeJsonFile(authPath, session)
  await chmodIfPossible(authPath, 0o600)
}

export async function clearAuthSession() {
  await removeIfExists(getGlobalAuthPath())
}
