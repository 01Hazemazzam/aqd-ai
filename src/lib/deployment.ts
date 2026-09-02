// What this particular deployment is, as far as the UI needs to know.
//
// Server-side only, deliberately: none of this is NEXT_PUBLIC_, so a page
// that branches on it must be a server component. That is a feature. These
// flags describe how an instance is run, and baking them into the client
// bundle would mean a redeploy to correct a lie the browser is telling.

/**
 * Whether this instance accepts new accounts.
 *
 * This does NOT close signups -- Supabase's own `enable_signup = false` does,
 * at the source, where no route or server action can get around it. This flag
 * only decides whether the signup screen offers a form or explains why there
 * isn't one, so that a closed deployment says so instead of showing a form
 * that fails.
 *
 * The two settings can disagree, and the runbook's verification step exists
 * to catch it: after deploying, POST the signup action and confirm the answer
 * comes back as "signups are closed" rather than an account.
 */
export function signupsOpen(): boolean {
  return process.env.SIGNUPS_CLOSED !== 'true'
}
