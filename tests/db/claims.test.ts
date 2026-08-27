// tests/db/claims.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string
let orgId: string

beforeAll(async () => {
  db = new Client({ connectionString: DB })
  await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'claims@test.local', '', now(), now())
     returning id`,
  )
  userId = u.rows[0].id
  const o = await db.query(
    `insert into public.organizations (name, slug) values ('Claims Org', 'claims-org') returning id`,
  )
  orgId = o.rows[0].id
  await db.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [orgId, userId])
})

afterAll(async () => {
  await db.query(`delete from auth.users where id = $1`, [userId])
  // auth.users cascades org_members, but not the organizations row itself —
  // clean it up explicitly so a second local run doesn't hit a duplicate
  // slug ('claims-org') on organizations_slug_key.
  await db.query(`delete from public.organizations where id = $1`, [orgId])
  await db.end()
})

describe('jwt claims', () => {
  it('stamps org_id and org_role into the token', async () => {
    const { rows } = await db.query(
      `select public.custom_access_token_hook(
         jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)
       ) as event`,
      [userId],
    )
    expect(rows[0].event.claims.org_id).toBe(orgId)
    expect(rows[0].event.claims.org_role).toBe('owner')
  })

  // These two tests set request.jwt.claims with is_local = false (session-level),
  // not true (transaction-local). Each `db.query()` call below is its own
  // autocommitted statement/transaction, so a transaction-local value set in one
  // call would already be gone by the next call — Postgres would revert it to ''
  // rather than the value we set, and jwt_org_id() would throw on the ''::jsonb
  // cast. Session-level set_config survives across separate round-trips like this.
  // The real production path doesn't need this: PostgREST wraps an entire request
  // (the SET LOCAL it issues and the query that follows) in one transaction, so
  // is_local = true works fine there. This only matters for a test driving two
  // separate queries over a raw connection.
  it('falls back to the membership table when the claim is absent', async () => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: userId }),
    ])
    const { rows } = await db.query(`select public.jwt_org_id() as org_id`)
    expect(rows[0].org_id).toBe(orgId)
  })

  it('prefers the claim over the fallback when both exist', async () => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: userId, org_id: orgId }),
    ])
    const { rows } = await db.query(`select public.jwt_org_id() as org_id`)
    expect(rows[0].org_id).toBe(orgId)
  })
})
