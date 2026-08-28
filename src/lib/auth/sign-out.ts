'use server'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

// The escape hatch for the mid-auth screens: a person who lands on verify or
// challenge for the wrong account (or just wants out) needs a way back to a
// clean /login. Clearing the session is what makes that a real sign-out rather
// than a redirect they bounce straight back from.
export async function signOut() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  redirect('/login')
}
