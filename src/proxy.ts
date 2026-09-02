import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Renamed from middleware.ts -- Next.js 16 deprecated the `middleware` file
// convention in favor of `proxy` (same behavior, same config/matcher shape,
// just a rename: https://nextjs.org/docs/messages/middleware-to-proxy).
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) response.cookies.set(name, value, options)
        },
      },
    },
  )

  try {
    await supabase.auth.getUser()
  } catch {
    // Only a transport failure lands here: an expired or invalid session is
    // returned as `{ error }`, not thrown, so this catch is specifically
    // "the auth server could not be reached at all".
    //
    // On the free tier that has one overwhelmingly likely cause -- the
    // project is paused after seven idle days and is waking up. Without this
    // the failure surfaces as the generic error boundary ("Something went
    // wrong. Nothing was lost."), which tells a first-time visitor that the
    // product is broken rather than that it is starting.
    //
    // A rewrite, not a redirect: the URL the visitor came for stays in the
    // address bar, so reloading once the project is awake lands them where
    // they were going.
    const { pathname } = request.nextUrl
    if (!pathname.startsWith('/api/') && pathname !== '/unavailable') {
      return NextResponse.rewrite(new URL('/unavailable', request.url))
    }
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
