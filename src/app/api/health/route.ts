import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Liveness, and the reason the demo is still awake when someone clicks the
 * link.
 *
 * Supabase pauses a free project after seven days without activity, which is
 * exactly the shape of a portfolio deployment: untouched for a fortnight,
 * then opened by the one person who matters, who gets a paused database. A
 * daily cron hitting this route runs one query, which is enough to count as
 * activity.
 *
 * The query is a real round trip to Postgres, not a ping of the API gateway:
 * `playbooks` grants SELECT to authenticated only, so an anonymous caller
 * gets an empty array -- but PostgREST still has to ask the database to find
 * that out, and a table that cannot be reached comes back as an error rather
 * than as nothing. Empty is healthy here; an error is not.
 *
 * Deliberately anonymous: it uses the anon key with no session, so there is
 * no path from this route to anyone's data even if the response shape changes
 * later. It reports liveness, never contents.
 */
export async function GET(request: Request) {
  // Vercel sends this header on scheduled invocations when CRON_SECRET is
  // configured. Checked only when the secret exists, so local and preview
  // deployments stay callable by hand -- and so a missing secret fails open
  // for a health check rather than closing a door nothing else opens.
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'unconfigured' }, { status: 503 })

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { error } = await supabase.from('playbooks').select('id').limit(1)
    if (error) return NextResponse.json({ ok: false, reason: 'database' }, { status: 503 })
  } catch {
    return NextResponse.json({ ok: false, reason: 'unreachable' }, { status: 503 })
  }

  return NextResponse.json({ ok: true })
}
