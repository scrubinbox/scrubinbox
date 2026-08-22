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

// Cloudflare's per-request cap on concurrent outbound connections. Every
// concurrent Gmail call we issue counts against this, so 6 is the ceiling.
const GMAIL_CONCURRENCY = 6

// One page of scan work is bounded by Cloudflare's 50-subrequest cap:
// 1 threads.list + up to 49 threads.get = 50 total.
export const SCAN_PAGE_SIZE = 49

// Same cap applies to trash: up to 49 threads.trash (or .delete) per batch.
export const TRASH_BATCH_SIZE = 49

export type ProjectedThread = {
  id: string
  from: string
  subject: string
  labelIds: string[]
  messageCount: number
}

export type ScanPage = {
  threads: ProjectedThread[]
  nextPageToken: string | null
}

export type TrashResult = {
  id: string
  success: boolean
  error?: string
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

// Refresh Google's OAuth refresh token into a fresh access token. Every
// Gmail-touching endpoint calls this once at the top; the token is only
// held in Worker memory for the duration of that request.
export async function getGmailAccessToken(
  env: Env,
  sql: Sql,
  userId: string,
): Promise<string> {
  const user = await getUserById(sql, userId)
  if (!user) throw new GmailProxyError(401, 'user_not_found', 'user not found')
  if (!user.encrypted_refresh_token) {
    throw new GmailProxyError(401, 'no_refresh_token', 'no refresh token — please sign in again')
  }
  const refreshToken = await decryptRefreshToken(
    user.encrypted_refresh_token,
    env.REFRESH_TOKEN_ENCRYPTION_KEY,
  )
  try {
    const refreshed = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      refreshToken,
    )
    return refreshed.access_token
  } catch (err) {
    throw new GmailProxyError(502, 'refresh_failed', (err as Error).message)
  }
}

// Same paid derivation as GET /api/me. Extracted so /api/trash and /api/me
// stay in lockstep — the trash endpoint is the trust boundary for the
// paywall, so this must not drift.
export async function getPaidStatus(sql: Sql, userId: string): Promise<boolean> {
  const entitlement = await getEntitlement(sql, userId)
  if (!entitlement) return false
  if (entitlement.expires_at === null) return true
  return new Date(entitlement.expires_at).getTime() > Date.now()
}

// Adapted from src/lib/asyncPool.js. Bounded concurrency for Gmail calls
// so we never exceed Cloudflare's 6-connection cap.
export async function pool<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length)
  let index = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++
        results[i] = await fn(items[i], i)
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
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  })
  return res
}

async function gmailJson<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await gmailFetch(accessToken, path, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GmailProxyError(502, 'gmail_error', `gmail ${path} ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

type LabelInfo = { id: string; name: string; type?: string; threadsTotal?: number }
type LabelsList = { labels?: LabelInfo[] }
type ProfileInfo = { emailAddress: string; threadsTotal?: number }
type ThreadsList = { threads?: { id: string }[]; nextPageToken?: string }
type RawHeader = { name: string; value: string }
type RawMessage = { id?: string; labelIds?: string[]; payload?: { headers?: RawHeader[] } }
type RawThread = { id: string; labelIds?: string[]; messages?: RawMessage[] }

export function listLabels(accessToken: string): Promise<LabelsList> {
  return gmailJson<LabelsList>(accessToken, '/labels')
}

async function getLabelThreadsTotal(accessToken: string, id: string): Promise<number> {
  const label = await gmailJson<LabelInfo>(accessToken, `/labels/${encodeURIComponent(id)}`)
  return label.threadsTotal ?? 0
}

export async function getInboxTotal(
  accessToken: string,
  includeArchived: boolean,
): Promise<number> {
  if (!includeArchived) {
    return getLabelThreadsTotal(accessToken, 'INBOX')
  }
  const [profile, trash, spam] = await Promise.all([
    gmailJson<ProfileInfo>(accessToken, '/profile'),
    getLabelThreadsTotal(accessToken, 'TRASH'),
    getLabelThreadsTotal(accessToken, 'SPAM'),
  ])
  return Math.max((profile.threadsTotal ?? 0) - trash - spam, 0)
}

function getHeader(headers: RawHeader[] | undefined, name: string): string {
  if (!headers) return ''
  const found = headers.find((h) => h.name === name)
  return found?.value ?? ''
}

function projectThread(raw: RawThread): ProjectedThread {
  const messages = raw.messages ?? []
  const firstMessage = messages[0]
  const headers = firstMessage?.payload?.headers
  const threadLabelIds = raw.labelIds ?? []
  const firstMsgLabelIds = firstMessage?.labelIds ?? []
  const labelIds = [...new Set([...threadLabelIds, ...firstMsgLabelIds])]
  return {
    id: raw.id,
    from: getHeader(headers, 'From'),
    subject: getHeader(headers, 'Subject'),
    labelIds,
    messageCount: messages.length,
  }
}

function buildQuery(includeArchived: boolean): string {
  return includeArchived ? '-in:trash -in:spam' : 'in:inbox'
}

export async function getScanPage(
  accessToken: string,
  args: { pageToken: string | null; includeArchived: boolean },
): Promise<ScanPage> {
  const params = new URLSearchParams({
    maxResults: String(SCAN_PAGE_SIZE),
    q: buildQuery(args.includeArchived),
  })
  if (args.pageToken) params.set('pageToken', args.pageToken)

  const list = await gmailJson<ThreadsList>(accessToken, `/threads?${params.toString()}`)
  const threadIds = (list.threads ?? []).map((t) => t.id)

  const metaParams = new URLSearchParams({ format: 'metadata' })
  metaParams.append('metadataHeaders', 'From')
  metaParams.append('metadataHeaders', 'Subject')

  const projected = await pool(threadIds, GMAIL_CONCURRENCY, async (id) => {
    const raw = await gmailJson<RawThread>(
      accessToken,
      `/threads/${encodeURIComponent(id)}?${metaParams.toString()}`,
    )
    return projectThread(raw)
  })

  return {
    threads: projected,
    nextPageToken: list.nextPageToken ?? null,
  }
}

export async function trashThreads(
  accessToken: string,
  threadIds: string[],
  permanent: boolean,
): Promise<TrashResult[]> {
  return pool(threadIds, GMAIL_CONCURRENCY, async (id) => {
    try {
      const path = permanent
        ? `/threads/${encodeURIComponent(id)}`
        : `/threads/${encodeURIComponent(id)}/trash`
      const res = await gmailFetch(accessToken, path, {
        method: permanent ? 'DELETE' : 'POST',
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { id, success: false, error: `${res.status} ${text}`.trim() }
      }
      return { id, success: true }
    } catch (err) {
      return { id, success: false, error: (err as Error).message }
    }
  })
}
