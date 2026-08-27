// tests/db/devices.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client
let userId: string

beforeAll(async () => {
  db = new Client({ connectionString: DB }); await db.connect()
  const u = await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'devices@test.local', '', now(), now()) returning id`,
  )
  userId = u.rows[0].id
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId })])
})

afterEach(async () => { await db.query(`delete from public.trusted_devices where user_id = $1`, [userId]) })
afterAll(async () => { await db.query(`delete from auth.users where id = $1`, [userId]); await db.end() })

describe('device trust', () => {
  it('trusts a device and recognises it afterwards', async () => {
    await db.query(`select public.trust_device('secret-a', 'Chrome on Windows', 30)`)
    const { rows } = await db.query(`select public.is_device_trusted('secret-a') as trusted`)
    expect(rows[0].trusted).toBe(true)
  })

  it('does not recognise an unknown device', async () => {
    const { rows } = await db.query(`select public.is_device_trusted('never-seen') as trusted`)
    expect(rows[0].trusted).toBe(false)
  })

  it('stores the hash, not the secret', async () => {
    await db.query(`select public.trust_device('secret-b', 'Safari', 30)`)
    const { rows } = await db.query(`select device_hash from public.trusted_devices where user_id = $1`, [userId])
    expect(rows[0].device_hash.toString()).not.toContain('secret-b')
  })

  it('stops recognising an expired device', async () => {
    await db.query(`select public.trust_device('secret-c', 'Firefox', 30)`)
    await db.query(`update public.trusted_devices set expires_at = now() - interval '1 day' where user_id = $1`, [userId])
    const { rows } = await db.query(`select public.is_device_trusted('secret-c') as trusted`)
    expect(rows[0].trusted).toBe(false)
  })

  it('revokes every device at once', async () => {
    await db.query(`select public.trust_device('secret-d', 'Chrome', 30)`)
    await db.query(`select public.trust_device('secret-e', 'Edge', 30)`)
    const { rows } = await db.query(`select public.revoke_all_devices() as n`)
    expect(rows[0].n).toBe(2)
    const check = await db.query(`select public.is_device_trusted('secret-d') as trusted`)
    expect(check.rows[0].trusted).toBe(false)
  })
})
