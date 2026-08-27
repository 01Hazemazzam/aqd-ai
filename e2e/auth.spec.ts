// e2e/auth.spec.ts
import { test, expect } from '@playwright/test'
import { Client } from 'pg'

const DB = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// Reads the code straight from the database — the dev mail transport doesn't send.
async function latestCode(email: string): Promise<string> {
  const db = new Client({ connectionString: DB })
  await db.connect()
  for (let attempt = 0; attempt < 10; attempt++) {
    const { rows } = await db.query(
      `select c.id from public.login_codes c
       join auth.users u on u.id = c.user_id
       where u.email = $1 and c.consumed_at is null
       order by c.created_at desc limit 1`, [email],
    )
    if (rows.length) break
    await new Promise((r) => setTimeout(r, 300))
  }
  // Brute-force the 6-digit space against the stored hash for test purposes only.
  const { rows } = await db.query(
    `select code from generate_series(0, 999999) g(n),
       lateral (select lpad(g.n::text, 6, '0') as code) s
     where digest(s.code, 'sha256') = (
       select c.code_hash from public.login_codes c
       join auth.users u on u.id = c.user_id
       where u.email = $1 and c.consumed_at is null
       order by c.created_at desc limit 1)
     limit 1`, [email],
  )
  await db.end()
  return rows[0].code
}

test('a new user signs up, verifies, and reaches the dashboard', async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a-long-enough-password')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

  const code = await latestCode(email)
  for (const [i, digit] of [...code].entries()) {
    await page.getByLabel(`Digit ${i + 1}`).fill(digit)
  }
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByRole('heading', { name: 'Create your organization' })).toBeVisible()
  await page.getByLabel('Organization name').fill('E2E Legal')
  await page.getByRole('button', { name: 'Create organization' }).click()

  await expect(page.getByRole('heading', { name: 'Aqd AI' })).toBeVisible()
})

test('an unverified visitor cannot reach the app by URL', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('signing in on a fresh device raises the challenge', async ({ browser }) => {
  const email = `e2e-dev-${Date.now()}@test.local`
  const first = await browser.newContext()
  const p1 = await first.newPage()
  await p1.goto('/signup')
  await p1.getByLabel('Email').fill(email)
  await p1.getByLabel('Password').fill('a-long-enough-password')
  await p1.getByRole('button', { name: 'Create account' }).click()
  const code = await latestCode(email)
  for (const [i, d] of [...code].entries()) await p1.getByLabel(`Digit ${i + 1}`).fill(d)
  await p1.getByRole('button', { name: 'Verify' }).click()
  await p1.getByLabel('Organization name').fill('Device Co')
  await p1.getByRole('button', { name: 'Create organization' }).click()
  await first.close()

  // A second context has no device cookie — this is the "new device" case.
  const second = await browser.newContext()
  const p2 = await second.newPage()
  await p2.goto('/login')
  await p2.getByLabel('Email').fill(email)
  await p2.getByLabel('Password').fill('a-long-enough-password')
  await p2.getByRole('button', { name: 'Sign in' }).click()
  await expect(p2.getByRole('heading', { name: 'Verify this device' })).toBeVisible()
  await second.close()
})
