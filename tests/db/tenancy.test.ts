// tests/db/tenancy.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
let db: Client

beforeAll(async () => {
  db = new Client({ connectionString: DB })
  await db.connect()
})

describe('tenancy schema', () => {
  it('creates the three tenancy tables', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1)`,
      [['organizations', 'org_members', 'invites']],
    )
    expect(rows.map((r) => r.table_name).sort()).toEqual(['invites', 'org_members', 'organizations'])
  })

  it('enables row level security on all of them', async () => {
    const { rows } = await db.query(
      `select relname, relrowsecurity from pg_class
       where relname = any($1)`,
      [['organizations', 'org_members', 'invites']],
    )
    for (const r of rows) expect(r.relrowsecurity).toBe(true)
  })

  it('stores invite tokens hashed, never in plaintext', async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'invites'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('token_hash')
    expect(cols).not.toContain('token')
  })
})
