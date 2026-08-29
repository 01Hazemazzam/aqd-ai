// tests/db/team-functions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHash, randomBytes } from 'node:crypto'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
let db: Client
let ownerId: string, memberId: string, outsiderId: string

// Stamping org_id/org_role explicitly (rather than relying on jwt_org_id()'s
// created_at-order fallback) matters here specifically because these tests
// reuse the same few users across many orgs created in different tests --
// the fallback would silently resolve to whichever org that user joined
// first, not the one the current test actually cares about.
const asUser = async (id: string, org?: { orgId: string; role: 'owner' | 'admin' | 'member' }) =>
  db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify(org ? { sub: id, org_id: org.orgId, org_role: org.role } : { sub: id }),
  ])

async function createTestUser(email: string) {
  const { rows } = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             $1, '', now(), now()) returning id`,
    [email],
  )
  return rows[0].id as string
}

beforeAll(async () => {
  db = new Client({ connectionString: DB })
  await db.connect()
  ownerId = await createTestUser('team-fn-owner@test.local')
  memberId = await createTestUser('team-fn-member@test.local')
  outsiderId = await createTestUser('team-fn-outsider@test.local')
})

afterAll(async () => {
  // organizations has no FK back to auth.users, so deleting the test users
  // alone leaves every org this file created orphaned rather than cleaned up
  // -- explicit deletion here, not reliance on cascade.
  await db.query(`delete from public.organizations where name like 'team-fn-test:%'`)
  await db.query(`delete from auth.users where id = any($1)`, [[ownerId, memberId, outsiderId]])
  await db.end()
})

describe('create_invite', () => {
  it('lets an owner create an invite, hashed with the token the caller receives', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Invite Fn Org') as org_id`)
    const orgId = org.rows[0].org_id

    await asUser(ownerId, { orgId, role: 'owner' })
    const { rows } = await db.query(`select public.create_invite('newperson@test.local', 'member') as token`)
    const token = rows[0].token
    expect(typeof token).toBe('string')

    const hash = createHash('sha256').update(token).digest()
    const inv = await db.query(
      `select role, expires_at > now() as not_expired from public.invites where org_id = $1 and email = 'newperson@test.local' and token_hash = $2`,
      [orgId, hash],
    )
    expect(inv.rows).toHaveLength(1)
    expect(inv.rows[0].role).toBe('member')
    expect(inv.rows[0].not_expired).toBe(true)
  })

  it('refuses a plain member (not_authorized)', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Member Cannot Invite Org') as org_id`)
    await db.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'member')`, [org.rows[0].org_id, memberId])

    await asUser(memberId, { orgId: org.rows[0].org_id, role: 'member' })
    await expect(db.query(`select public.create_invite('x@test.local', 'member')`)).rejects.toThrow(/not_authorized/)
  })

  it('refuses an admin trying to grant the owner role (privilege escalation)', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Admin Cannot Grant Owner Org') as org_id`)
    await db.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'admin')`, [org.rows[0].org_id, memberId])

    await asUser(memberId, { orgId: org.rows[0].org_id, role: 'admin' })
    await expect(db.query(`select public.create_invite('x2@test.local', 'owner')`)).rejects.toThrow(/not_authorized/)
  })

  it('replaces an existing live invite for the same email rather than duplicating it', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Reinvite Org') as org_id`)
    const orgId = org.rows[0].org_id

    await asUser(ownerId, { orgId, role: 'owner' })
    await db.query(`select public.create_invite('repeat@test.local', 'member')`)
    await db.query(`select public.create_invite('repeat@test.local', 'admin')`)

    const { rows } = await db.query(
      `select role from public.invites where org_id = $1 and email = 'repeat@test.local' and accepted_at is null`,
      [orgId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe('admin')
  })
})

describe('list_org_members', () => {
  it('returns members with real emails, scoped to the caller\'s own org', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Roster Org') as org_id`)
    await db.query(`insert into public.org_members (org_id, user_id, role) values ($1, $2, 'member')`, [org.rows[0].org_id, memberId])

    await asUser(ownerId, { orgId: org.rows[0].org_id, role: 'owner' })
    const { rows } = await db.query(`select * from public.list_org_members()`)
    const emails = rows.map((r: { email: string }) => r.email)
    expect(emails).toContain('team-fn-owner@test.local')
    expect(emails).toContain('team-fn-member@test.local')
    expect(emails).not.toContain('team-fn-outsider@test.local')
  })
})

describe('preview_invite', () => {
  it('returns nothing for a token that does not match any live invite', async () => {
    await asUser(outsiderId)
    const { rows } = await db.query(`select * from public.preview_invite('not-a-real-token')`)
    expect(rows).toHaveLength(0)
  })

  it('returns nothing for an expired invite', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Expired Preview Org') as org_id`)
    const token = randomBytes(24).toString('hex')
    const hash = createHash('sha256').update(token).digest()
    await db.query(
      `insert into public.invites (org_id, email, role, token_hash, expires_at)
       values ($1, 'team-fn-outsider@test.local', 'member', $2, now() - interval '1 day')`,
      [org.rows[0].org_id, hash],
    )

    await asUser(outsiderId)
    const { rows } = await db.query(`select * from public.preview_invite($1)`, [token])
    expect(rows).toHaveLength(0)
  })

  it('returns the org name and role for a real, live invite (positive case)', async () => {
    await asUser(ownerId)
    const org = await db.query(`select public.create_organization('team-fn-test: Real Preview Org') as org_id`)
    const token = randomBytes(24).toString('hex')
    const hash = createHash('sha256').update(token).digest()
    await db.query(
      `insert into public.invites (org_id, email, role, token_hash, expires_at)
       values ($1, 'team-fn-outsider@test.local', 'admin', $2, now() + interval '7 days')`,
      [org.rows[0].org_id, hash],
    )

    await asUser(outsiderId)
    const { rows } = await db.query(`select * from public.preview_invite($1)`, [token])
    expect(rows).toHaveLength(1)
    expect(rows[0].org_name).toBe('team-fn-test: Real Preview Org')
    expect(rows[0].role).toBe('admin')
  })
})
