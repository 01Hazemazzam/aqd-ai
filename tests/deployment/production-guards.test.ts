// tests/deployment/production-guards.test.ts
//
// The deployment decisions that are one line of code each, and therefore the
// ones a later change can undo without anything failing. Each of these was a
// blocker found by auditing the repo against a real deployment target, not a
// hypothetical.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { toAuthErrorCode } from '@/lib/auth/errors'

describe('the dev code reveal cannot reach a deployed database', () => {
  // `dev_peek_code` returns the caller's own live login code. It is gated in
  // the app layer, but PostgREST publishes every function granted to
  // `authenticated` at /rest/v1/rpc/ -- so a session holder sitting on the
  // device challenge could read the code that was about to be emailed to the
  // account's real owner, and walk through the second factor.
  //
  // `supabase db push` applies migrations and nothing else, so the guarantee
  // is exactly this: whatever the migrations say last about that function has
  // to be "drop".
  const dir = 'supabase/migrations'
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

  it('leaves no dev_peek_code behind after the last migration', () => {
    const mentions = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes('dev_peek_code'))
    const last = mentions[mentions.length - 1]

    expect(mentions.length).toBeGreaterThan(0)
    expect(readFileSync(join(dir, last), 'utf8')).toMatch(/drop function if exists public\.dev_peek_code/)
  })

  // The local convenience has to survive, or the next person to run
  // `supabase db reset` finds the verify and challenge screens are dead ends
  // with no email transport and no way past them.
  it('keeps it in the local-only seed, which db push never applies', () => {
    const seed = readFileSync('supabase/seed.sql', 'utf8')

    expect(seed).toMatch(/create or replace function public\.dev_peek_code/)
    expect(seed).toMatch(/grant execute on function public\.dev_peek_code\(public\.code_purpose\) to authenticated/)
  })
})

describe('a closed deployment says so', () => {
  const original = process.env.SIGNUPS_CLOSED
  afterEach(() => {
    if (original === undefined) delete process.env.SIGNUPS_CLOSED
    else process.env.SIGNUPS_CLOSED = original
    vi.resetModules()
  })

  const load = async () => {
    vi.resetModules()
    return (await import('@/lib/deployment')).signupsOpen()
  }

  it('offers the form when nothing says otherwise -- local and e2e depend on it', async () => {
    delete process.env.SIGNUPS_CLOSED
    expect(await load()).toBe(true)
  })

  it('explains instead of offering a form when the flag is set', async () => {
    process.env.SIGNUPS_CLOSED = 'true'
    expect(await load()).toBe(false)
  })

  // Anything other than the exact string leaves signups open. A flag that
  // half-matches ("1", "yes", "TRUE") and silently closes a form is worse
  // than one that ignores you.
  it('takes only the exact value, so a near-miss fails open and visibly', async () => {
    process.env.SIGNUPS_CLOSED = 'yes'
    expect(await load()).toBe(true)
  })
})

describe('a refused signup reads as a decision, not a fault', () => {
  // Before this mapping existed, GoTrue's refusal collapsed into `unknown` --
  // "Something went wrong. Please try again." -- on a deployment where trying
  // again can never work.
  it('recognises the refusal GoTrue actually sends', () => {
    expect(toAuthErrorCode({ message: 'Signups not allowed for this instance' })).toBe('signups_closed')
    expect(toAuthErrorCode({ message: 'Signup is disabled' })).toBe('signups_closed')
  })

  it('still collapses every credential failure into one code', () => {
    expect(toAuthErrorCode({ message: 'Invalid login credentials' })).toBe('invalid_credentials')
    expect(toAuthErrorCode({ message: 'User not found' })).toBe('invalid_credentials')
  })
})

describe('the upload limit is the one the clock allows', () => {
  const original = process.env.NEXT_PUBLIC_MAX_UPLOAD_MB
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_MAX_UPLOAD_MB
    else process.env.NEXT_PUBLIC_MAX_UPLOAD_MB = original
    vi.resetModules()
  })

  const load = async () => {
    vi.resetModules()
    return import('@/lib/upload-limit')
  }

  // It was 50 MB, sized against Supabase's per-file cap. The binding
  // constraint is the 60-second function ceiling: a 50 MB document does not
  // get rejected at the limit, it gets accepted and then killed at the wall
  // clock, a minute later, mid-write.
  it('defaults to 10 MB', async () => {
    delete process.env.NEXT_PUBLIC_MAX_UPLOAD_MB
    const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } = await load()

    expect(MAX_UPLOAD_MB).toBe(10)
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024)
  })

  it('is overridable, and the byte count follows the megabyte count', async () => {
    process.env.NEXT_PUBLIC_MAX_UPLOAD_MB = '25'
    const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } = await load()

    expect(MAX_UPLOAD_MB).toBe(25)
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024)
  })
})

describe('every route that can reach a model declares its ceiling', () => {
  // Without an explicit maxDuration the platform default is 10 seconds --
  // shorter than a healthy analysis, which measured 17.6s against a live
  // provider. The failure is a killed function, not a slow one.
  const ROUTES = [
    'src/app/api/chat/route.ts',
    'src/app/api/chat/portfolio/route.ts',
    'src/app/(app)/contracts/[id]/page.tsx',
    'src/app/(app)/contracts/page.tsx',
    'src/app/(app)/help/page.tsx',
  ]

  it.each(ROUTES)('%s declares maxDuration', (path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/export const maxDuration = 60/)
  })
})

describe('the AI budget fits inside the invocation that has to contain it', () => {
  const original = process.env.AI_RETRY_ATTEMPTS
  beforeEach(() => {
    delete process.env.AI_RETRY_ATTEMPTS
  })
  afterEach(() => {
    if (original === undefined) delete process.env.AI_RETRY_ATTEMPTS
    else process.env.AI_RETRY_ATTEMPTS = original
  })

  // The arithmetic, asserted rather than trusted to a comment:
  //   attempts x timeout + backoff + one fallback call  <  the 60s ceiling
  // At the previous default of 4 attempts this came to 82s, which is only
  // ever reached when things are already going wrong -- the worst moment to
  // discover the function is being killed rather than returning an error.
  it('keeps the worst case under 60 seconds', () => {
    const source = readFileSync('src/lib/ai/router.ts', 'utf8')
    const attempts = Number(/AI_RETRY_ATTEMPTS \?\? (\d+)/.exec(source)?.[1])
    const timeoutMs = Number(/AI_REQUEST_TIMEOUT_MS \?\? (\d+)/.exec(source)?.[1])

    expect(attempts).toBeGreaterThan(1)
    const backoffMs = Array.from({ length: attempts - 1 }, (_, i) => 2 ** i * 1000).reduce((a, b) => a + b, 0)
    const worstCaseMs = attempts * timeoutMs + backoffMs + timeoutMs

    expect(worstCaseMs).toBeLessThan(60_000)
  })
})
