import { NextResponse } from 'next/server'
import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getDeviceSecret } from '@/lib/auth/device'
import { issueAndSendCode } from '@/lib/auth/codes'
import type { Locale } from '@/lib/i18n/config'

// Google OAuth's counterpart to login/actions.ts's signIn. The device-trust
// check and the `login` event are duplicated here deliberately -- everything
// downstream of session creation (requireVerified, the challenge screen,
// getCurrentOrgId's redirect to /onboarding) already works for any provider,
// per the design's "additive, not a restructure" note. This route is the one
// place that actually needed a second branch.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')

  if (oauthError || !code) {
    return NextResponse.redirect(`${origin}/login?oauthError=1`)
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?oauthError=1`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.redirect(`${origin}/login?oauthError=1`)
  }

  await supabase.from('auth_events').insert({ kind: 'login' })

  const secret = await getDeviceSecret()
  const { data: trusted } = await supabase.rpc('is_device_trusted', { p_secret: secret ?? '' })
  if (trusted) {
    return NextResponse.redirect(`${origin}/`)
  }

  const locale = (await getLocale()) as Locale
  await issueAndSendCode('device_challenge', user.email, locale)
  return NextResponse.redirect(`${origin}/challenge`)
}
