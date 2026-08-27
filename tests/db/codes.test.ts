// tests/db/codes.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string

const asUser = async (c: Client, id: string) =>
  c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: id })])

beforeAll(async () => {
  db = new Client({ connectionString: DB }); await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'codes@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
  await asUser(db, userId)
})

afterEach(async () => {
  await db.query(`delete from public.login_codes where user_id = $1`, [userId])
  await db.query(`delete from public.rate_limits`)
})

afterAll(async () => { await db.query(`delete from auth.users where id = $1`, [userId]); await db.end() })

describe('issue_code', () => {
  it('returns a six digit code and stores only its hash', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    expect(rows[0].code).toMatch(/^\d{6}$/)
    const stored = await db.query(`select code_hash from public.login_codes where user_id = $1`, [userId])
    expect(stored.rows[0].code_hash.toString()).not.toContain(rows[0].code)
  })

  it('invalidates any previous live code of the same purpose', async () => {
    await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)
    await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)
    const { rows } = await db.query(
      `select count(*)::int as n from public.login_codes
       where user_id = $1 and consumed_at is null`, [userId],
    )
    expect(rows[0].n).toBe(1)
  })

  it('rate limits after five requests in an hour', async () => {
    for (let i = 0; i < 5; i++) await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)
    await expect(db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)).rejects.toThrow(/rate_limited/)
  })
})

describe('verify_code', () => {
  const verify = async (c: Client, code: string, purpose = 'signup_verify') =>
    (await c.query(`select public.verify_code($1, $2) as r`, [code, purpose])).rows[0].r as string

  it('accepts the right code once and refuses it thereafter', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    expect(await verify(db, rows[0].code)).toBe('ok')
    expect(await verify(db, rows[0].code)).toBe('code_incorrect')
  })

  it('refuses a code issued for a different purpose', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    expect(await verify(db, rows[0].code, 'device_challenge')).toBe('code_incorrect')
  })

  it('refuses an expired code', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    await db.query(`update public.login_codes set expires_at = now() - interval '1 minute' where user_id = $1`, [userId])
    expect(await verify(db, rows[0].code)).toBe('code_expired')
  })

  it('counts wrong attempts and burns the code on the fifth', async () => {
    await db.query(`select public.issue_code('signup_verify', '127.0.0.1')`)

    for (let i = 0; i < 4; i++) expect(await verify(db, '000000')).toBe('code_incorrect')
    expect(await verify(db, '000000')).toBe('code_burned')

    const { rows } = await db.query(
      `select attempt_count, consumed_at from public.login_codes where user_id = $1`, [userId],
    )
    expect(rows[0].attempt_count).toBe(5)
    expect(rows[0].consumed_at).not.toBeNull()
  })

  it('lets exactly one of two parallel verifications succeed', async () => {
    const { rows } = await db.query(`select public.issue_code('signup_verify', '127.0.0.1') as code`)
    const code = rows[0].code

    const a = new Client({ connectionString: DB })
    const b = new Client({ connectionString: DB })
    await a.connect(); await b.connect()
    await asUser(a, userId); await asUser(b, userId)

    const [ra, rb] = await Promise.all([verify(a, code), verify(b, code)])
    await a.end(); await b.end()

    // The row lock is what makes this true. Without FOR UPDATE, both pass.
    expect([ra, rb].filter((r) => r === 'ok')).toHaveLength(1)
  })
})
