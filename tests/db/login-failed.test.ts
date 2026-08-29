// tests/db/login-failed.test.ts
//
// P1 fix: login_failed was documented as deliberately deferred since
// Sub-project 1 -- a failed login has no session, so events_own_insert's
// `user_id = auth.uid()` RLS check can't pass for a direct insert. This
// tests the security-definer function that bridges it: log_login_failed
// takes the plaintext email (all login/actions.ts has at that point), looks
// the user up internally, and must behave identically (silently) whether or
// not the email matches a real account -- an observable difference there
// would make this a second account-enumeration oracle.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
let db: Client
let userId: string

beforeAll(async () => {
  db = new Client({ connectionString: DB })
  await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'login-failed-fn@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
})

afterEach(async () => {
  await db.query(`delete from public.auth_events where user_id = $1`, [userId])
})

afterAll(async () => {
  await db.query(`delete from auth.users where id = $1`, [userId])
  await db.end()
})

describe('log_login_failed', () => {
  it('records a login_failed event for a real email', async () => {
    await db.query(`select public.log_login_failed('login-failed-fn@test.local')`)
    const { rows } = await db.query(
      `select kind from public.auth_events where user_id = $1 and kind = 'login_failed'`,
      [userId],
    )
    expect(rows).toHaveLength(1)
  })

  it('writes nothing for an email that matches no account -- no enumeration signal', async () => {
    // No exception, no row anywhere -- the only observable check available is
    // that this specific user's event count is unaffected.
    await expect(db.query(`select public.log_login_failed('no-such-account@test.local')`)).resolves.toBeDefined()
    const { rows } = await db.query(`select count(*)::int as n from public.auth_events where user_id = $1`, [userId])
    expect(rows[0].n).toBe(0)
  })

  it('does not error on an empty or missing email', async () => {
    await expect(db.query(`select public.log_login_failed('')`)).resolves.toBeDefined()
    await expect(db.query(`select public.log_login_failed(null)`)).resolves.toBeDefined()
  })
})
