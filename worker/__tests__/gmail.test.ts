import { describe, it, expect } from 'vitest'
import { isEntitlementActive, pool } from '../gmail'

describe('isEntitlementActive', () => {
  it('returns false when no entitlement row exists', () => {
    expect(isEntitlementActive(null)).toBe(false)
  })

  it('returns true when expires_at is null (lifetime)', () => {
    expect(isEntitlementActive({ expires_at: null })).toBe(true)
  })

  it('returns true when expires_at is in the future', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    expect(isEntitlementActive({ expires_at: future })).toBe(true)
    expect(isEntitlementActive({ expires_at: future.toISOString() })).toBe(true)
  })

  it('returns false when expires_at is in the past', () => {
    const past = new Date(Date.now() - 1000)
    expect(isEntitlementActive({ expires_at: past })).toBe(false)
    expect(isEntitlementActive({ expires_at: past.toISOString() })).toBe(false)
  })
})

describe('pool', () => {
  it('preserves input order in results', async () => {
    const results = await pool([1, 2, 3, 4, 5], async (n) => n * 2)
    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it('bounds concurrency to CONCURRENCY (6) inflight tasks', async () => {
    let inflight = 0
    let peak = 0
    const results = await pool(Array.from({ length: 20 }, (_, i) => i), async (i) => {
      inflight++
      peak = Math.max(peak, inflight)
      await new Promise((r) => setTimeout(r, 5))
      inflight--
      return i
    })
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
  })

  it('propagates errors from any worker', async () => {
    await expect(
      pool([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })

  it('returns empty array for empty input', async () => {
    const results = await pool<number, number>([], async (n) => n)
    expect(results).toEqual([])
  })
})
