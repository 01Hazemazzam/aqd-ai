# Deploying Aqd as a demo

This deploys Aqd to Vercel + Supabase + Gemini + Resend at no cost. It is a
**portfolio deployment**: signups are closed, the only content is synthetic,
and the AI runs on a free tier that Google may train on. Read
[ADR-0006](adr/0006-production-is-a-demo-deployment.md) before changing any of
that — several of the steps below only make sense together.

Everything here is a command or a named dashboard control. If a step is
missing from your project, it is a step somebody skipped.

---

## 0. Before you start

You need accounts on Vercel, Supabase, Google AI Studio and Resend, the
Supabase CLI (`npx supabase --version` is enough), and this repo pushed to
GitHub.

**One thing to decide first: whose email address.** The demo account's address
must be the address your Resend account owns, because the sending domain is
Resend's sandbox (`onboarding@resend.dev`) and a sandbox only ever delivers to
its own account holder. Every code this deployment sends — signup, reset,
device challenge — goes to that one address. See §7 if you want that to
change.

---

## 1. Create and link the Supabase project

Create a project in the dashboard (any region; the free tier is one project's
worth of resources). Then, from the repo root:

```bash
npx supabase link --project-ref <your-project-ref>
```

Push the schema. This runs every migration in `supabase/migrations/`, in
order, including the storage bucket and its policies:

```bash
npx supabase db push
```

`supabase/seed.sql` is **not** pushed, and that is deliberate: it recreates
`dev_peek_code`, the local-only helper that reveals your own login code when
there is no email transport. Migration `0020` drops that function precisely so
it cannot exist here. Verify:

```bash
npx supabase db push --dry-run   # should report nothing left to apply
```

## 2. Auth settings that do not live in `config.toml`

`supabase/config.toml` configures the **local** stack. The cloud project reads
its own settings, so these have to be pushed or set by hand.

```bash
npx supabase config push
```

If your CLI version does not support it, set these in the dashboard instead:

| Setting | Where | Value |
|---|---|---|
| Custom access token hook | Authentication → Hooks | Enable, Postgres function `public.custom_access_token_hook` |
| Allow new users to sign up | Authentication → Sign In / Providers | **Off** |
| Site URL | Authentication → URL Configuration | `https://<your-app>.vercel.app` |
| Redirect URLs | Authentication → URL Configuration | `https://<your-app>.vercel.app/**` |

The hook is the one people miss. Without it, `org_id` never lands in the JWT
and every request falls through to `jwt_org_id()`'s membership lookup — the
app still works, which is exactly why the mistake survives.

Migration `0002` already grants the hook to `supabase_auth_admin`, so there is
nothing further to run.

## 3. Create the demo account

Authentication → Users → **Add user**. Use the address from §0, set a
password, and tick *Auto Confirm User* — with signups closed there is no
confirmation flow to complete.

The account has no organisation yet. Either sign in once and let the
onboarding screen create one, or let the seed in §4 do it.

## 4. Seed the demo content

Get the connection string from Project Settings → Database, then:

```bash
psql "$SUPABASE_DB_URL" -v owner_email=you@example.com -f supabase/seed-demo.sql
```

No quotes around the address — the script quotes it. This inserts two drafts
of a synthetic MSA with their clauses, analyses, risk findings and evidence,
which is enough to populate the dashboard, the risk portfolio, the obligations
register, the intelligence views and the version comparison. It creates an
organisation for the account if it does not have one, and it is safe to re-run
(the contract is deleted and rebuilt).

Nothing in it costs AI quota, and nothing in it is a real contract.

## 5. Deploy to Vercel

Import the repo. Framework preset: Next.js. Leave the build command alone.

Environment variables — every one of these is server-side except the two
`NEXT_PUBLIC_` entries, which are public by design (an anon key is enforced by
RLS, and an upload limit is a published number):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API | The anon key, never the service role key |
| `GEMINI_API_KEY` | Google AI Studio | Free tier — read §7 |
| `RESEND_API_KEY` | Resend dashboard | |
| `EMAIL_FROM` | `onboarding@resend.dev` | Sandbox sender; delivers only to your Resend account address |
| `DEVICE_COOKIE_NAME` | any stable string | e.g. `aqd_device` |
| `SIGNUPS_CLOSED` | `true` | Makes the signup screen say so |
| `NEXT_PUBLIC_MAX_UPLOAD_MB` | `10` | Also the default; set it explicitly so it is visible |
| `CRON_SECRET` | a long random string | Vercel sends it to `/api/health` |

Deliberately **not** set:

- `ANTHROPIC_API_KEY` — no task uses the `heavy` tier, and leaving it unset
  means any future heavy call falls back rather than failing.
- `OPENROUTER_API_KEY` — optional. Set it if you want a second provider to
  cover Gemini's daily quota; leave it and Gemini failures surface as
  themselves.
- `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google
  sign-in is off; the button degrades to "Google sign-in isn't configured yet."

`vercel.json` registers the daily cron against `/api/health`. Hobby allows one
daily schedule, which is all this needs.

## 6. Verify the deployment

Do all of these. Each one has failed for somebody.

```bash
# 1. Health, and the query that keeps Supabase awake
curl -s https://<app>.vercel.app/api/health          # {"ok":true}

# 2. The dev code reveal must not exist. 404 or "function not found" is the
#    pass; a 200 with a code means migration 0020 did not reach this database.
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/dev_peek_code" \
  -H "apikey: $ANON_KEY" -H "content-type: application/json" \
  -d '{"p_purpose":"device_challenge"}'
```

3. Open `/signup`. It must show "This deployment is a demo", not a form.
4. Sign in as the demo account. The device challenge fires; the code must
   arrive in the inbox from §0. If it does not, check the Vercel logs for a
   Resend `validation_error` — that is the sandbox refusing an address it does
   not own.
5. Open a contract, then *What changed*. The comparison should show 5
   modified, 1 added, 1 removed, 6 unchanged.
6. Click **Analyze** on the seeded contract. This is the only step that spends
   AI quota; it proves the Gemini key and that the work fits in 60 seconds.
7. Check Vercel → Settings → Cron Jobs lists `/api/health` as daily.

## 7. What this deployment is not

**Email reaches exactly one address.** The Resend sandbox delivers only to the
account owner. Anyone else who somehow got an account could never receive a
device-challenge code. Fixing that costs about $10/year: verify a domain in
Resend, change `EMAIL_FROM` to an address on it. Nothing else changes.

**Gemini's free tier is not confidential.** Google states that content
submitted to non-paid services may be used to improve their products, may be
reviewed by humans, and that confidential information should not be sent. That
is why the seeded contracts are invented and why signups are closed: this
deployment must never receive a real contract. If you want real documents in
it, move to the paid Gemini tier first — that is the switch that makes the
data-handling story defensible, and it is a billing change, not a code change.

**Supabase Free pauses after 7 idle days.** The cron is what prevents it. If
the project is paused anyway (cron disabled, quota, a long outage), the app
detects the unreachable database in `src/proxy.ts` and shows "The demo is
waking up" instead of a generic error.

**There are no backups on the free tier.** Everything here is reproducible
from migrations plus `seed-demo.sql`, which is the only reason that is
acceptable.

## 8. Limits you will actually meet

| Limit | Value | What happens |
|---|---|---|
| Vercel function duration | 60s (Hobby) | The AI retry budget is sized to fit; see `src/lib/ai/router.ts` |
| Supabase database | 500 MB | Thousands of contracts away |
| Supabase storage | 1 GB | ~100 documents at the 10 MB cap |
| Supabase idle pause | 7 days | Prevented by the cron |
| Resend | 100 emails/day, one recipient | Not a constraint for one account |
| Gemini free tier | Per-model daily quota | Analysis fails with "the provider's daily quota is exhausted" and says so |
