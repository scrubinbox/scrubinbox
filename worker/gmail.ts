// Server-side Gmail API proxy.
//
// The client never receives a Google access token — every Gmail API call
// goes through these helpers so the paywall (enforced in /api/trash) can
// live at the trust boundary. Each endpoint fits Cloudflare Workers Free
// plan limits: max 50 subrequests, 10ms CPU, 6 concurrent connections per
// request.

import { decryptRefreshToken } from './auth/crypto'
import { refreshAccessToken } from './auth/google'
import { getUserById, getEntitlement, type Sql } from './db'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// Cloudflare's per-request cap on concurrent outbound connections.
const CONCURRENCY = 6

// One scan page: 1 threads.list + up to 49 threads.get = 50 subrequests
// (Cloudflare's per-request cap). Trash uses the same 49 ceiling.
const SCAN_PAGE_SIZE = 49
export const TRASH_BATCH_SIZE = 49

export type ProjectedThread = {
  id: string
  from: string
  subject: string
  labelIds: string[]
  messageCount: number
}

type Env = {
  DATABASE_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  REFRESH_TOKEN_ENCRYPTION_KEY: string
}

export class GmailProxyError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Refresh Google's stored refresh token into a fresh access token. Only
// held in Worker memory for the duration of the current request.
export async function getGmailAccessToken(
  env: Env,
  sql: Sql,
  userId: string,
): Promise<string> {
  const user = await getUserById(sql, userId)
  if (!user) throw new GmailProxyError(401, 'user_not_found', 'user not found')
  if (!user.encrypted_refresh_token) {
    throw new GmailProxyError(401, 'no_refresh_token', 'sign in again')
  }
  const refreshToken = await decryptRefreshToken(
    user.encrypted_refresh_token,
    env.REFRESH_TOKEN_ENCRYPTION_KEY,
  )
  try {
    const { access_token } = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      refreshToken,
    )
    return access_token
  } catch (err) {
    throw new GmailProxyError(502, 'refresh_failed', (err as Error).message)
  }
}

// Shared paid-status derivation. /api/trash and /api/me both call this so
// the paywall trust boundary can't drift from what the client sees.
export async function getPaidStatus(sql: Sql, userId: string): Promise<boolean> {
  const entitlement = await getEntitlement(sql, userId)
  if (!entitlement) return false
  if (entitlement.expires_at === null) return true
  return new Date(entitlement.expires_at).getTime() > Date.now()
}

// Bounded-concurrency fan-out. Workers pull from a shared index; single-
// threaded JS makes `i++` atomic.
async function pool<T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length)
  let index = 0
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++
        results[i] = await fn(items[i])
      }
    },
  )
  await Promise.all(workers)
  return results
}

async function gmailFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
  })
}

async function gmailJson<T>(accessToken: string, path: string): Promise<T> {
  const res = await gmailFetch(accessToken, path)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GmailProxyError(502, 'gmail_error', `${path} ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

type LabelRow = { id: string; name: string; type?: string; threadsTotal?: number }

export function listLabels(
  accessToken: string,
): Promise<{ labels?: LabelRow[] }> {
  return gmailJson(accessToken, '/labels')
}

async function labelThreadsTotal(accessToken: string, id: string): Promise<number> {
  const label = await gmailJson<LabelRow>(accessToken, `/labels/${encodeURIComponent(id)}`)
  return label.threadsTotal ?? 0
}

export async function getInboxTotal(
  accessToken: string,
  includeArchived: boolean,
): Promise<number> {
  if (!includeArchived) return labelThreadsTotal(accessToken, 'INBOX')
  const [profile, trash, spam] = await Promise.all([
    gmailJson<{ threadsTotal?: number }>(accessToken, '/profile'),
    labelThreadsTotal(accessToken, 'TRASH'),
    labelThreadsTotal(accessToken, 'SPAM'),
  ])
  return Math.max((profile.threadsTotal ?? 0) - trash - spam, 0)
}

type RawThread = {
  id: string
  labelIds?: string[]
  messages?: {
    labelIds?: string[]
    payload?: { headers?: { name: string; value: string }[] }
  }[]
}

export async function getScanPage(
  accessToken: string,
  args: { pageToken: string | null; includeArchived: boolean },
): Promise<{ threads: ProjectedThread[]; nextPageToken: string | null }> {
  const listParams = new URLSearchParams({
    maxResults: String(SCAN_PAGE_SIZE),
    q: args.includeArchived ? '-in:trash -in:spam' : 'in:inbox',
  })
  if (args.pageToken) listParams.set('pageToken', args.pageToken)

  const list = await gmailJson<{
    threads?: { id: string }[]
    nextPageToken?: string
  }>(accessToken, `/threads?${listParams.toString()}`)
  const threadIds = (list.threads ?? []).map((t) => t.id)

  // format=metadata + metadataHeaders keeps the response small: no body,
  // no attachment payloads. Only From and Subject headers plus label IDs.
  const metaQs =
    'format=metadata&metadataHeaders=From&metadataHeaders=Subject'

  const threads = await pool(threadIds, async (id) => {
    const raw = await gmailJson<RawThread>(
      accessToken,
      `/threads/${encodeURIComponent(id)}?${metaQs}`,
    )
    const first = raw.messages?.[0]
    const headers = first?.payload?.headers ?? []
    const fromHeader = headers.find((h) => h.name === 'From')?.value ?? ''
    const subjectHeader = headers.find((h) => h.name === 'Subject')?.value ?? ''
    return {
      id: raw.id,
      from: fromHeader,
      subject: subjectHeader,
      labelIds: [...new Set([...(raw.labelIds ?? []), ...(first?.labelIds ?? [])])],
      messageCount: raw.messages?.length ?? 0,
    }
  })

  return { threads, nextPageToken: list.nextPageToken ?? null }
}

export function trashThreads(
  accessToken: string,
  threadIds: string[],
  permanent: boolean,
): Promise<{ id: string; success: boolean; error?: string }[]> {
  const method = permanent ? 'DELETE' : 'POST'
  return pool(threadIds, async (id) => {
    const path = permanent
      ? `/threads/${encodeURIComponent(id)}`
      : `/threads/${encodeURIComponent(id)}/trash`
    try {
      const res = await gmailFetch(accessToken, path, { method })
      if (res.ok) return { id, success: true }
      const text = await res.text().catch(() => '')
      return { id, success: false, error: `${res.status} ${text}`.trim() }
    } catch (err) {
      return { id, success: false, error: (err as Error).message }
    }
  })
}
