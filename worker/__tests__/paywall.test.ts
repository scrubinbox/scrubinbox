/**
 * Trust-boundary test for /api/trash.
 *
 * If this test starts failing, the paywall may be reintroducing the bypass
 * vulnerability that PR #62 fixed. Do not weaken it lightly.
 *
 * What it locks in:
 *   1. POST /api/trash with an unpaid user returns HTTP 403 { error: 'not_paid' }.
 *   2. getGmailAccessToken() is NEVER called on the unpaid path. This is the
 *      structural invariant — the paid check MUST happen before any Gmail
 *      credential access, so a code reshuffle can't accidentally hand out
 *      access-token-adjacent state to an unpaid caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGmailAccessTokenMock = vi.fn()
const trashThreadsMock = vi.fn()
const getEntitlementMock = vi.fn()

vi.mock('../gmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gmail')>()
  return {
    ...actual,
    getGmailAccessToken: getGmailAccessTokenMock,
    trashThreads: trashThreadsMock,
  }
})

vi.mock('../db', () => ({
  db: () => ({}),
  getUserById: vi.fn(),
  getEntitlement: getEntitlementMock,
  getTrialState: vi.fn(),
  upsertUser: vi.fn(),
  insertScanLog: vi.fn(),
  upsertEntitlement: vi.fn(),
  upsertTrialState: vi.fn(),
}))

vi.mock('../auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/session')>()
  return {
    ...actual,
    requireSession: () => async (c: any, next: any) => {
      c.set('userId', 'test-user-id')
      await next()
    },
  }
})

const app = (await import('../index')).default

const ENV = {
  DATABASE_URL: 'postgres://test',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  REFRESH_TOKEN_ENCRYPTION_KEY: 'test-key',
  SESSION_SIGNING_SECRET: 'test-signing-secret',
  STRIPE_SECRET_KEY: 'test-stripe',
  STRIPE_WEBHOOK_SECRET: 'test-webhook',
  STRIPE_PRICE_ID: 'test-price',
  APP_URL: 'http://localhost',
}

async function postTrash() {
  return app.fetch(
    new Request('http://localhost/api/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadIds: ['thread-1'], permanent: false }),
    }),
    ENV,
  )
}

describe('/api/trash paywall trust boundary', () => {
  beforeEach(() => {
    getGmailAccessTokenMock.mockReset()
    trashThreadsMock.mockReset()
    getEntitlementMock.mockReset()
  })

  it('returns 403 not_paid and never calls getGmailAccessToken when unpaid', async () => {
    getEntitlementMock.mockResolvedValue(null)

    const res = await postTrash()

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_paid' })
    expect(getGmailAccessTokenMock).not.toHaveBeenCalled()
    expect(trashThreadsMock).not.toHaveBeenCalled()
  })

  it('returns 403 not_paid and never calls getGmailAccessToken when entitlement is expired', async () => {
    getEntitlementMock.mockResolvedValue({
      user_id: 'test-user-id',
      type: 'annual',
      expires_at: new Date(Date.now() - 1000),
    })

    const res = await postTrash()

    expect(res.status).toBe(403)
    expect(getGmailAccessTokenMock).not.toHaveBeenCalled()
    expect(trashThreadsMock).not.toHaveBeenCalled()
  })

  it('proceeds past the paid check when entitlement is active (lifetime)', async () => {
    getEntitlementMock.mockResolvedValue({
      user_id: 'test-user-id',
      type: 'lifetime',
      expires_at: null,
    })
    getGmailAccessTokenMock.mockResolvedValue('fake-access-token')
    trashThreadsMock.mockResolvedValue([{ id: 'thread-1', success: true }])

    const res = await postTrash()

    expect(res.status).toBe(200)
    expect(getGmailAccessTokenMock).toHaveBeenCalledOnce()
    expect(trashThreadsMock).toHaveBeenCalledOnce()
  })
})
