// tests/db/isolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let admin: Client
let alice: string
let bob: string
let aliceOrg: string
let bobOrg: string

const makeUser = async (email: string) => {
  const { rows } = await admin.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             $1, '', now(), now()) returning id`, [email],
  )
  return rows[0].id as string
}

// A client that behaves like PostgREST does for a signed-in user: the
// `authenticated` role, with the JWT claims set. This is what RLS sees.
const asUser = async (userId: string) => {
  const c = new Client({ connectionString: DB })
  await c.connect()
  await c.query(`set role authenticated`)
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  return c
}

beforeAll(async () => {
  admin = new Client({ connectionString: DB }); await admin.connect()
  alice = await makeUser('alice@isolation.test')
  bob = await makeUser('bob@isolation.test')

  const a = await asUser(alice)
  aliceOrg = (await a.query(`select public.create_organization('Alice Legal') as id`)).rows[0].id
  await a.end()

  const b = await asUser(bob)
  bobOrg = (await b.query(`select public.create_organization('Bob Legal') as id`)).rows[0].id
  await b.end()
})

afterAll(async () => {
  await admin.query(`delete from auth.users where id = any($1)`, [[alice, bob]])
  await admin.end()
})

describe('cross-tenant isolation', () => {
  it('shows each user only their own organization', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select id from public.organizations`)
    await a.end()
    expect(rows.map((r) => r.id)).toEqual([aliceOrg])
  })

  it('returns nothing when one user queries the other org by id', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select id from public.organizations where id = $1`, [bobOrg])
    await a.end()
    expect(rows).toHaveLength(0)
  })

  it('hides the other org members', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select user_id from public.org_members`)
    await a.end()
    expect(rows.map((r) => r.user_id)).toEqual([alice])
  })

  it('refuses a write into the other org', async () => {
    const a = await asUser(alice)
    await expect(
      a.query(`insert into public.invites (org_id, email, role, token_hash, expires_at)
               values ($1, 'x@y.z', 'member', digest('t','sha256'), now() + interval '1 day')`, [bobOrg]),
    ).rejects.toThrow(/row-level security/)
    await a.end()
  })

  it('never exposes a login code, not even the caller\'s own', async () => {
    const a = await asUser(alice)
    const { rows } = await a.query(`select count(*)::int as n from public.login_codes`)
    await a.end()
    expect(rows[0].n).toBe(0)
  })
})
