import { neon } from '@neondatabase/serverless'

export type Sql = ReturnType<typeof neon>

export function db(databaseUrl: string): Sql {
  return neon(databaseUrl)
}

export type UserRow = {
  id: string
  google_sub: string
  email: string
  encrypted_refresh_token: Uint8Array | null
}

export type EntitlementRow = {
  user_id: string
  type: 'lifetime' | 'annual'
  expires_at: string | null
}

export type TrialStateRow = {
  user_id: string
  trial_used_at: string | null
}

export async function upsertUserByGoogleSub(
  sql: Sql,
  args: { googleSub: string; email: string; encryptedRefreshToken: Uint8Array | null },
): Promise<UserRow> {
  const rows = (await sql`
    insert into users (google_sub, email, encrypted_refresh_token)
    values (${args.googleSub}, ${args.email}, ${args.encryptedRefreshToken})
    on conflict (google_sub) do update
      set email = excluded.email,
          encrypted_refresh_token = coalesce(excluded.encrypted_refresh_token, users.encrypted_refresh_token),
          updated_at = now()
    returning id, google_sub, email, encrypted_refresh_token
  `) as UserRow[]
  return rows[0]
}

export async function ensureTrialState(sql: Sql, userId: string): Promise<void> {
  await sql`
    insert into trial_state (user_id) values (${userId})
    on conflict (user_id) do nothing
  `
}

export async function getUserById(sql: Sql, userId: string): Promise<UserRow | null> {
  const rows = (await sql`
    select id, google_sub, email, encrypted_refresh_token
    from users where id = ${userId}
  `) as UserRow[]
  return rows[0] ?? null
}

export async function getEntitlement(
  sql: Sql,
  userId: string,
): Promise<EntitlementRow | null> {
  const rows = (await sql`
    select user_id, type, expires_at
    from entitlements where user_id = ${userId}
  `) as EntitlementRow[]
  return rows[0] ?? null
}

export async function getTrialState(
  sql: Sql,
  userId: string,
): Promise<TrialStateRow | null> {
  const rows = (await sql`
    select user_id, trial_used_at
    from trial_state where user_id = ${userId}
  `) as TrialStateRow[]
  return rows[0] ?? null
}

export async function insertScanLog(
  sql: Sql,
  args: { userId: string; threadsScanned: number; threadsTrashed: number },
): Promise<void> {
  await sql`
    insert into scan_logs (user_id, threads_scanned, threads_trashed)
    values (${args.userId}, ${args.threadsScanned}, ${args.threadsTrashed})
  `
}

export async function upsertEntitlement(
  sql: Sql,
  args: {
    userId: string
    type: 'lifetime' | 'annual'
    stripeSessionId: string
    stripeCustomerId: string
    earlyAdopter: boolean
  },
): Promise<void> {
  await sql`
    insert into entitlements
      (user_id, type, stripe_session_id, stripe_customer_id, early_adopter)
    values
      (${args.userId}, ${args.type}, ${args.stripeSessionId}, ${args.stripeCustomerId}, ${args.earlyAdopter})
    on conflict (user_id) do update
      set type = excluded.type,
          stripe_session_id = excluded.stripe_session_id,
          stripe_customer_id = excluded.stripe_customer_id,
          early_adopter = excluded.early_adopter
  `
}
