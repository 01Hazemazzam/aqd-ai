import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client

beforeAll(async () => { db = new Client({ connectionString: DB }); await db.connect() })
afterAll(async () => { await db.end() })

describe('identity schema', () => {
  it('creates the identity tables', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1)`,
      [['trusted_devices', 'login_codes', 'rate_limits', 'auth_events']],
    )
    expect(rows).toHaveLength(4)
  })

  it('defines the code purpose enum with exactly two values', async () => {
    const { rows } = await db.query(
      `select enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid where t.typname = 'code_purpose'
       order by enumlabel`,
    )
    expect(rows.map((r) => r.enumlabel)).toEqual(['device_challenge', 'signup_verify'])
  })

  it('grants SELECT on login_codes to nobody', async () => {
    const { rows } = await db.query(
      `select polcmd from pg_policy p
       join pg_class c on c.oid = p.polrelid
       where c.relname = 'login_codes' and p.polcmd = 'r'`,
    )
    expect(rows).toHaveLength(0)
  })

  it('stores only hashes, never a plaintext code or device secret', async () => {
    const { rows } = await db.query(
      `select table_name, column_name from information_schema.columns
       where table_name in ('login_codes', 'trusted_devices')`,
    )
    const cols = rows.map((r) => `${r.table_name}.${r.column_name}`)
    expect(cols).toContain('login_codes.code_hash')
    expect(cols).toContain('trusted_devices.device_hash')
    expect(cols).not.toContain('login_codes.code')
    expect(cols).not.toContain('trusted_devices.device_secret')
  })
})
