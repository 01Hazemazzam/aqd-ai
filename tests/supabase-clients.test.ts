// tests/supabase-clients.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
  })

describe('supabase client usage', () => {
  it('never references a service role key anywhere in src', () => {
    const offenders = walk('src').filter((f) => /SERVICE_ROLE/i.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  // Middleware is the one documented exception: it must read and write cookies
  // through the request/response pair, which `lib/supabase/server.ts` cannot do
  // because that module goes through `next/headers`. Naming the exception here
  // keeps the rule enforceable everywhere else.
  const CLIENT_EXCEPTIONS = [join('src', 'middleware.ts')]

  it('constructs clients only inside lib/supabase', () => {
    const offenders = walk('src')
      .filter((f) => !f.includes(join('lib', 'supabase')))
      .filter((f) => !CLIENT_EXCEPTIONS.some((e) => f.endsWith(e)))
      .filter((f) => /createServerClient|createBrowserClient/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
