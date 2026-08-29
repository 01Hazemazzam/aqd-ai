# Aqd AI — Resend + Google OAuth Setup Runbook

Scope confirmed from the repo (`D:\AI-WORK\projects-claude\folder-1`): local-only dev, Next.js 16 + Supabase CLI (Docker), no production deployment, no owned domain yet. Everything below is written for that state, with the production path noted separately so you don't have to redo the research later.

---

## 1. Exact credentials/configuration to create

| Item | Where | Notes |
|---|---|---|
| Resend account | resend.com | Free tier: 100 emails/day, 3,000/month — plenty for dev/testing |
| Resend API key | Resend dashboard → API Keys | Scope: "Sending access" is enough; don't grant full access |
| Google Cloud project | console.cloud.google.com | Reuse an existing project if you have one; a new one is fine too |
| OAuth consent screen | Same project | External + "Testing" mode — no Google verification needed while only you/test users sign in |
| OAuth Client ID (Web application) | Same project → Credentials | This is the piece Supabase's Google provider needs |

You do the clicking; paste nothing to me. Put the results straight into `.env.local`.

---

## 2. Environment variables to add

Your `.env.example` already declares every slot correctly — this just says what goes in each one.

```bash
# Resend
RESEND_API_KEY=                          # from Resend dashboard → API Keys
EMAIL_FROM="Aqd <onboarding@resend.dev>" # see §5 — dev sender, change later with a real domain

# Google OAuth (Supabase external provider)
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID= # Google Cloud → Credentials → your OAuth client → Client ID
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=    # same screen → Client secret
NEXT_PUBLIC_GOOGLE_CLIENT_ID=            # same value as SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID (not secret)
```

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` stay whatever `npx supabase start` printed — unrelated to this work, don't touch them.

After editing `.env.local`, restart `next dev` (env vars are read at process start) **and** restart the local Supabase stack (`npx supabase stop && npx supabase start`) — `config.toml` pulls `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`SECRET` via `env(...)` substitution at stack start, not at request time, so GoTrue won't see new values until it restarts.

---

## 3. Supabase settings to change

**None.** `supabase/config.toml` already has `[auth.external.google] enabled = true` wired to pull from the two env vars above. This was clearly built expecting exactly this setup — don't add a `redirect_uri` override or touch `skip_nonce_check` under `[auth.external.apple]` (that key is unrelated to Google in this file; it's leftover generator boilerplate). The only action is restarting the stack so it picks up the new env vars, per §2.

---

## 4. Google OAuth redirect URLs

This is the part it's easy to get wrong: **Google's redirect URI is Supabase's GoTrue callback, not your app's `/auth/callback` route.** Your app's own route (`src/app/auth/callback/route.ts`) is where *Supabase* redirects you after it finishes the exchange — Google never talks to it directly.

For this local stack (API port remapped to `55321` per `config.toml`, see the README's Windows port-exclusion note):

- **Authorized redirect URI:** `http://127.0.0.1:55321/auth/v1/callback`
- **Authorized JavaScript origins:** `http://localhost:3000` (your Next dev server; Google accepts this even though the OAuth flow itself is server-driven, and it doesn't hurt to add it)

Do not use `http://localhost:55321` — Supabase's own `site_url`/redirect allow-list in `config.toml` is set to `127.0.0.1`, and GoTrue's provider callback URI must match the exact host you actually hit. If you ever change the local port remap, this URI changes with it.

**Later, in production**, you'll add a *second* Authorized redirect URI (Google supports multiple) pointing at your hosted Supabase project: `https://<your-project-ref>.supabase.co/auth/v1/callback`. You don't have a production Supabase project yet, so there's nothing to add now — just don't delete the local one when that day comes; add alongside it.

---

## 5. Resend sending-domain configuration

**You don't need a verified domain for local dev at all.** Two options, in order of what I'd actually do:

**Option A — skip Resend entirely for now (recommended while iterating).** Leave `RESEND_API_KEY` blank. The codebase already has a deliberate fallback (`src/lib/auth/email.ts`, `DevCodeHint` component): with no key set, verification codes print to the server console and render directly on `/verify`/`/challenge` via `DevCodeHint`. This is real code the project was built around, not a hack — use it until you actually need to see a real inbox.

**Option B — verify real sending now, using Resend's sandbox domain.** Create the API key, set:
```
EMAIL_FROM="Aqd <onboarding@resend.dev>"
```
`resend.dev` is Resend's own pre-verified test domain — no DNS work required, and it proves the API key, the `Resend` SDK call, and your `sendCodeEmail`/`sendInviteEmail` functions all work end-to-end with a real send. Limitation: Resend will only deliver test-domain mail to the email address on your Resend account (their anti-abuse restriction) — fine for you testing signup as yourself, not fine for a second tester's inbox.

**What you'll need later, once you own a real domain** (you said none yet — do this when you register one):

1. Pick a sending subdomain, not the bare domain — e.g. `mail.yourdomain.com` or `send.yourdomain.com`. Keeps transactional-email reputation isolated from your main domain/website mail.
2. Resend dashboard → Domains → Add Domain → enter the subdomain.
3. Resend generates three DNS records for you to add at your registrar/DNS host:
   - **DKIM** — a `TXT` record (Resend shows the exact host/value; typically `resend._domainkey.mail.yourdomain.com`)
   - **SPF** — a `TXT` record on the subdomain itself (`v=spf1 include:amazonses.com ~all` or similar, exact value comes from Resend since they send via their infrastructure)
   - **MX** (sometimes) — only if Resend also wants to receive bounce/complaint mail on that subdomain; check what they show you, don't assume
   - Recommended but not required by Resend: a **DMARC** `TXT` record at `_dmarc.mail.yourdomain.com` (e.g. `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`) — improves deliverability and gives you bounce/spoofing reports
4. Add the records at whichever DNS host the domain uses (Cloudflare, Namecheap, Route53, etc. — you haven't picked a registrar yet either, so this is just "wherever you end up").
5. Back in Resend, click "Verify" — propagation is usually minutes, can take up to ~48h depending on the DNS host's TTL.
6. Once verified, change `EMAIL_FROM` to `"Aqd <auth@mail.yourdomain.com>"` (or whatever local-part you want) in both local `.env.local` and your production environment.

---

## 6. Production/local differences

| | Local (now) | Production (later) |
|---|---|---|
| Supabase | CLI/Docker, `http://127.0.0.1:55321` | Hosted project, `https://<ref>.supabase.co` |
| Google redirect URI | `http://127.0.0.1:55321/auth/v1/callback` | `https://<ref>.supabase.co/auth/v1/callback` (add as a second URI on the same OAuth client — don't create a second client) |
| OAuth consent screen | "Testing" mode, add yourself as a test user | Needs "In production" + verification once you have real users beyond the ~100 test-user cap |
| Resend sender | `onboarding@resend.dev` (sandbox) or blank | Verified subdomain of your real domain |
| `EMAIL_FROM` | `Aqd <onboarding@resend.dev>` | `Aqd <auth@mail.yourdomain.com>` |
| `NEXT_PUBLIC_SUPABASE_URL` | local API URL | hosted project URL |
| Where env vars live | `.env.local` (gitignored — confirmed in `.gitignore` and `supabase/.gitignore`) | Vercel project env vars (or wherever you deploy) |

---

## 7. What Claude Code must implement

**Nothing.** This was the notable finding: the codebase already fully implements both integrations —

- `src/lib/auth/email.ts` — Resend client, `sendCodeEmail`/`sendInviteEmail`, graceful no-key fallback
- `src/components/auth/google-button.tsx` — Google sign-in button with a "not configured" degrade path when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset
- `src/app/auth/callback/route.ts` — the app-side OAuth callback after Supabase's own exchange
- `supabase/config.toml` — `[auth.external.google]` already `enabled = true`, wired to the right env vars

This is purely a credentials/configuration task, not a coding task. Don't add a redirect_uri override, don't add a second Google button component, don't touch the callback route — all of it is already correct for this exact setup.

---

## 8. What must be tested live

Do these against the running local stack (`npx supabase start` + `npm run dev`) after filling `.env.local`, in this order:

1. **Resend send** — sign up with a real email you control → confirm the verification-code email actually arrives (not just the dev-mode on-page code) → confirm the code works at `/verify`.
2. **Google button, not-configured path** (do this *before* filling Google env vars, as a regression check) — click "Continue with Google" with the client ID blank → confirm you get the clean "isn't configured" message, not a crash.
3. **Google OAuth end-to-end** — after filling `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`SECRET`/`NEXT_PUBLIC_GOOGLE_CLIENT_ID` and restarting both `supabase` and `next dev` — click "Continue with Google" → complete Google's consent screen → confirm you land back on `/` (or `/challenge` if device trust doesn't recognize the browser) via `/auth/callback`, and that `auth_events` gets a `login` row.
4. **New-device challenge via Google** — if you test from a browser Supabase hasn't seen before, confirm it correctly routes to `/challenge` and the challenge code path (still governed by whatever `RESEND_API_KEY` state you're in) works too.
5. **Invite email**, if you touch team features while you're in here — same Resend path, different template.

---

## 9. What must NOT be changed

- Don't commit `.env.local` (already gitignored, confirmed — leave it that way).
- Don't create a second Google OAuth client for production later — add production's redirect URI to the *same* client (§6). A second client means two sets of credentials to keep in sync for no benefit.
- Don't grant the Resend API key more than "Sending access" scope.
- Don't hardcode `http://127.0.0.1:55321` anywhere in app code — it's already correctly sourced from Supabase's own local config, not app config; the URI only matters at the Google Cloud Console and Supabase config layer.
- Don't remove or bypass the `DevCodeHint`/no-key fallback in `email.ts` — it's load-bearing for anyone else running this repo without a Resend key (see README's "Getting unstuck locally").
- Don't set `RESEND_API_KEY` and then forget to also set `EMAIL_FROM` — `email.ts` does `process.env.EMAIL_FROM!` (non-null assertion); a real key with a blank `EMAIL_FROM` will throw at send time instead of degrading gracefully.

---

## 10. Final verification checklist

- [ ] Resend account created, API key generated with sending-access scope
- [ ] `.env.local`: `RESEND_API_KEY` and `EMAIL_FROM` set (sandbox `onboarding@resend.dev` for now)
- [ ] Real signup email received and its code verified successfully
- [ ] Google Cloud project + OAuth consent screen (External, Testing, your account added as a test user)
- [ ] OAuth Client ID (Web application) created, Authorized redirect URI = `http://127.0.0.1:55321/auth/v1/callback`, Authorized JS origin = `http://localhost:3000`
- [ ] `.env.local`: `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set
- [ ] `npx supabase stop && npx supabase start` run after setting the Google env vars (config.toml env substitution needs a restart)
- [ ] `npm run dev` restarted after editing `.env.local`
- [ ] "Continue with Google" completes end-to-end and lands on `/` or `/challenge`
- [ ] `auth_events` shows the new `login` row (spot-check via Supabase Studio at `http://127.0.0.1:55323`)
- [ ] Noted for later: buy domain → Resend "Add Domain" on a subdomain → add DKIM/SPF/(DMARC) records → verify → switch `EMAIL_FROM` → add prod Supabase URL as a second Google redirect URI on the same client
