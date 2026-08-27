import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHash, randomBytes } from 'node:crypto'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string

// `false` = session-level, not transaction-local. A plain pg.Client
// autocommits each query() call separately, so a LOCAL-scoped value set here
// would be gone before the next query() runs jwt_org_id()/create_organization()
// — this is the exact bug Task 7's claims.test.ts hit and diagnosed first.
const asUser = async (id: string) =>
  db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: id })])

beforeAll(async () => {
  db = new Client({ connectionString: DB }); await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'orgfn@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
})

afterAll(async () => { await db.query(`delete from auth.users where id = $1`, [userId]); await db.end() })

describe('create_organization', () => {
  it('creates the org and makes the caller its owner', async () => {
    await asUser(userId)
    const { rows } = await db.query(`select public.create_organization('Kuwait Legal') as org_id`)
    const orgId = rows[0].org_id
    const m = await db.query(
      `select role from public.org_members where org_id = $1 and user_id = $2`, [orgId, userId],
    )
    expect(m.rows[0].role).toBe('owner')
  })

  it('generates a unique slug when names collide', async () => {
    await asUser(userId)
    await db.query(`select public.create_organization('Kuwait Legal')`)
    const { rows } = await db.query(`select slug from public.organizations where name = 'Kuwait Legal'`)
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length)
  })
})

describe('accept_invite', () => {
  it('joins the org and burns the invite', async () => {
    const token = randomBytes(24).toString('base64url')
    const hash = createHash('sha256').update(token).digest()
    await asUser(userId)
    const o = await db.query(`select public.create_organization('Inviting Co') as org_id`)
    await db.query(
      `insert into public.invites (org_id, email, role, token_hash, expires_at)
       values ($1, 'orgfn@test.local', 'member', $2, now() + interval '7 days')`,
      [o.rows[0].org_id, hash],
    )
    const { rows } = await db.query(`select public.accept_invite($1) as org_id`, [token])
    expect(rows[0].org_id).toBe(o.rows[0].org_id)
    const inv = await db.query(`select accepted_at from public.invites where token_hash = $1`, [hash])
    expect(inv.rows[0].accepted_at).not.toBeNull()
  })

  it('refuses an expired invite', async () => {
    const token = randomBytes(24).toString('base64url')
    const hash = createHash('sha256').update(token).digest()
    await asUser(userId)
    const o = await db.query(`select public.create_organization('Expired Co') as org_id`)
    await db.query(
      `insert into public.invites (org_id, email, role, token_hash, expires_at)
       values ($1, 'orgfn@test.local', 'member', $2, now() - interval '1 day')`,
      [o.rows[0].org_id, hash],
    )
    await expect(db.query(`select public.accept_invite($1)`, [token])).rejects.toThrow(/invite_invalid/)
  })
})
