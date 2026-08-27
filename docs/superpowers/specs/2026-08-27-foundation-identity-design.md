# Aqd AI Rebuild — Sub-project 1: Foundation & Identity

**Date:** 2026-08-27
**Status:** Design approved, ready for implementation planning
**Scope:** The first of five sub-projects. Ships the design system, multi-tenant foundation, and the complete authentication surface including device-trust 2FA.

---

## 1. Context

We are rebuilding the Aqd AI platform described in `aqd-ai-project-overview.md`: a bilingual (Arabic-first / English) AI contract-analysis SaaS. A user uploads a contract, the system segments it into clauses, AI produces a summary, extracted fields, risk findings and an obligations calendar, and a citation-locked chat answers questions using only the document.

The stated priority order for this rebuild is **frontend quality first, security second**. That ordering drives two decisions that differ from a conventional build order: the design system ships in sub-project 1 rather than a later polish phase, and the authentication surface is treated as a set of designed screens rather than plumbing.

### Decomposition

The full platform is too large for one specification. It is split into five sub-projects, each ending in an independently testable state:

| # | Sub-project | Exit test |
|---|---|---|
| 1 | **Foundation & Identity** (this spec) | Two users in different orgs cannot read each other's rows, proven in raw SQL; the full auth flow works on finished screens |
| 2 | Document pipeline & reader | A bilingual PDF renders clause-by-clause, both scripts correct |
| 3 | Analysis | Re-analysing an unchanged document is a cache hit |
| 4 | Citation-locked chat | Asking something absent from the document produces a refusal |
| 5 | Product helper assistant & polish | The assistant answers product questions and cannot answer data questions |

### Decisions already settled

- **Stack:** Next.js 16 (App Router) + Supabase. Anthropic and Gemini called directly behind a router interface; OpenRouter is not used.
- **Visual direction:** "Editorial light (paper)" as the primary theme — warm off-white surfaces, serif display and clause numbers, ink-black text — with the original spec's ink-navy dark as the second theme. Both generated from one set of OKLCH tokens.
- **Contract workspace layout** (relevant to sub-project 2, recorded here so the kit is built for it): a wide clause reader plus one tabbed rail carrying risks / summary / fields, with the chat docked beneath the rail, and risk severity markers in the reader's margin gutter.
- **Authentication:** email and password, a 6-digit code at signup, and on login a password alone on a trusted device or an emailed code challenge on a new one, with "trust this device for 30 days".
- **Google OAuth is deferred to sub-project 5.** The button is cheap; the second identity path is not — OAuth users have no password, so password-reset-revokes-devices and the challenge flow each need a second branch with a doubled test surface. The device-trust check sits after session creation and is therefore provider-agnostic, so adding Google later is additive rather than a restructure.

---

## 2. Architecture

One Next.js application deployed to Vercel. Supabase provides Postgres, authentication, storage and (from sub-project 4 onward) pgvector. There is no separate backend service: every server concern is a route handler or a server action.

### The load-bearing rule

**Server code always uses the user's own session client, never the service-role key.** Row-Level Security then enforces tenancy at the database, and a bug in a route handler cannot leak another organisation's rows.

Three categories of operation legitimately need to cross that boundary:

1. Creating an organisation (`create_organization`)
2. Accepting an invite (`accept_invite`)
3. Writing and verifying one-time codes and trusted-device records for a user who is authenticated but not yet fully verified

All three are `security definer` SQL functions with narrow, explicit signatures. No service-role key appears in any request path.

### Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `lib/supabase/` | Browser client, server session client. The only place a client may be constructed. | Supabase SDK |
| `lib/auth/` | The only module that knows about one-time codes, device trust and step-up. Exposes `requireSession()`, `requireVerified()`, `issueCode()`, `verifyCode()`, `trustDevice()`, `revokeDevice()`. | `lib/supabase/` |
| `lib/i18n/` | Locale cookie, message loading, `dir` resolution. | next-intl |
| `components/ui/` | The design-system kit. No feature component may define its own colour or spacing value. | design tokens |
| `app/(marketing)` | Public pages. No auth guard. | `components/ui/` |
| `app/(auth)` | Login, signup, verify, challenge, reset. Redirects verified users away. | `lib/auth/` |
| `app/(app)` | The product. Layout-level guard demands a fully verified session. | `lib/auth/` |
| `app/onboarding` | Create organisation, or accept invite. Requires a verified session, no organisation. | `lib/auth/` |

Route handlers call `lib/auth/`; they never touch the auth tables directly. This keeps every rule about code expiry, attempt counting and device trust in one readable module rather than scattered across endpoints.

### Guard placement

The `(app)` route group is protected at the layout level by `requireVerified()`, so a half-authenticated user cannot reach application data by typing a URL. The check is a server-side database read on each navigation, memoised per request. There is no client-side flag that grants entry.

---

## 3. Data model

Supabase's `auth.users` holds the email and password hash. Everything below is application-owned.

### Tenancy

- **`organizations`** — `id`, `name`, `slug`, `created_at`
- **`org_members`** — `org_id`, `user_id`, `role` (`owner` | `admin` | `member`), `created_at`
- **`invites`** — `id`, `org_id`, `email`, `role`, `token_hash`, `expires_at`, `accepted_at`

Invite tokens are stored hashed and compared by hash, with the same discipline as a password. The plaintext token exists only in the invitation email.

### Identity

- **`trusted_devices`** — `id`, `user_id`, `device_hash`, `label`, `user_agent`, `last_seen_at`, `expires_at`, `revoked_at`
- **`login_codes`** — `id`, `user_id`, `code_hash`, `purpose` (`signup_verify` | `device_challenge`), `expires_at`, `consumed_at`, `attempt_count`
- **`rate_limits`** — `subject` (user id or IP), `action`, `window_start`, `count`

`purpose` is an enum, and a code issued for one purpose is rejected for the other. Without this, a signup verification code could be replayed as a 2FA bypass.

### Audit

- **`auth_events`** — `id`, `user_id`, `org_id`, `kind`, `ip`, `user_agent`, `created_at`

Event kinds: `signup`, `login`, `login_failed`, `code_sent`, `code_failed`, `code_send_failed`, `device_trusted`, `device_revoked`, `password_changed`, `email_changed`. Writing these now costs nothing and is what makes the security screens in sub-project 5 possible.

### Tenancy enforcement

A custom access token hook stamps `org_id` and `org_role` into the JWT at mint time. SQL helpers `jwt_org_id()` and `jwt_org_role()` read those claims, **with a fallback that queries `org_members` directly** — a token minted before the user joined an organisation carries no claim, and without the fallback that user is locked out of their own data until they re-authenticate.

Every org-scoped table has RLS filtering on `jwt_org_id()`. `trusted_devices`, `login_codes` and `auth_events` are user-scoped and filter on `auth.uid()`.

**`login_codes` grants `SELECT` to no one.** Codes are written and verified only inside `security definer` functions. Even with a valid session and an arbitrary query, a user cannot read their own code hash. This removes an entire class of attack against the verification flow.

### Two deliberate details

- **`device_hash`, not a device ID.** The cookie holds a random secret; the table stores only its hash, salted per user. An attacker with a database dump has nothing they can present as a device.
- **Rate limiting lives in Postgres.** A counter table keyed on subject, action and window. Supabase's free tier has no Redis, and a second vendor is not worth this one feature. Limits: five code requests per hour per user and per IP, five verification attempts per code, after which the code is burned.

---

## 4. Authentication flows

### Signup

1. Email and password create the `auth.users` row with the email unconfirmed.
2. Supabase is configured to send a **6-digit code rather than a magic link** — the confirm-signup template emits the token instead of a URL.
3. The user lands on the verify screen and enters the code.
4. On success, one transaction confirms the email, records the current device as trusted, and writes an `auth_events` row.
5. Onboarding follows: create an organisation, or accept a pending invite matching the email.

### Login

1. Password authenticates and yields a Supabase session.
2. The `(app)` layout calls `requireVerified()`, which hashes the device cookie and looks for a live `trusted_devices` row.
3. Trusted and unexpired → the user proceeds.
4. Otherwise the session is authenticated but **not cleared**: a `device_challenge` code is emailed, the user is redirected to the challenge screen, and every `(app)` route bounces back until the challenge passes.

"Trust this device for 30 days" is a checkbox on the challenge screen. Left unchecked, the device row is written with an expiry tied to the session and a session-scoped cookie, so the next login challenges again.

### Required behaviours

- **Verification is row-locked.** `verify_code()` selects the code row `FOR UPDATE` before checking and consuming it. Without the lock, two parallel requests can both succeed against a single-use code.
- **Password reset revokes every trusted device.** Otherwise a stolen password already used from a trusted device keeps working after the reset — the most commonly missed step in device-trust 2FA.
- **Email change re-verifies and drops device trust.**
- **Failed attempts are counted, not merely expired.** Five wrong attempts burn the code and write an `auth_events` row.
- **Uniform responses.** Unknown email, wrong password and unverified account return the same message and take the same time, so the login form is not an account-enumeration oracle. The same applies to the code screens.

---

## 5. Design system

The design system is a deliverable of this sub-project, not a by-product.

### Tokens

All colour is expressed as OKLCH custom properties in `globals.css`. Twelve token names carry both themes; dark mode swaps values, never names, so there is no second stylesheet.

| Token | Light | Dark |
|---|---|---|
| `--color-surface` | `oklch(97% .008 85)` | `oklch(17% .017 250)` |
| `--color-surface-2` | `oklch(99% .005 85)` | `oklch(20% .019 250)` |
| `--color-surface-3` | `oklch(95% .011 85)` | `oklch(22% .020 250)` |
| `--color-edge` | `oklch(89% .014 85)` | `oklch(28% .021 250)` |
| `--color-ink` | `oklch(21% .006 75)` | `oklch(94% .008 250)` |
| `--color-ink-dim` | `oklch(43% .012 80)` | `oklch(70% .028 250)` |
| `--color-ink-faint` | `oklch(60% .013 80)` | `oklch(58% .031 250)` |
| `--color-accent` | `oklch(44% .068 165)` | `oklch(78% .095 178)` |
| `--color-brass` | `oklch(52% .069 78)` | `oklch(72% .118 88)` |
| `--color-risk-high` | `oklch(53% .148 18)` | `oklch(75% .134 18)` |
| `--color-risk-medium` | `oklch(60% .112 70)` | `oklch(82% .108 82)` |
| `--color-risk-low` | `oklch(53% .062 160)` | `oklch(80% .085 160)` |

Brass is a brand signature — logo, clause numbers, citation flash. It never appears on a button.

### Typography

Newsreader carries display type and clause numbers; Inter carries UI. Their Arabic counterparts are Amiri (Naskh, display) and IBM Plex Sans Arabic (UI).

Arabic body text uses a line-height of 1.9 against Latin's 1.7. Naskh looks cramped when the two are matched. This asymmetry lives in the tokens, not in individual components.

### Kit

`components/ui/` ships: Button (primary, secondary, ghost, danger), Input with focus and error states, the six-box verification code input with resend timer, Card, Badge, risk severity pills, Spinner, Tabs, and the clause row with its margin severity marker.

**Risk severity is never communicated by colour alone.** Each level carries a distinct glyph and a word, so it survives greyscale, colour-blindness and print.

### Bidirectionality

Only logical CSS properties are used — `ms-`/`me-`, `ps-`/`pe-`, `text-start`, `inset-inline-start`. RTL mirrors automatically; nothing is hand-flipped. Every user-visible string lives in `messages/en.json` or `messages/ar.json` from the first commit. Locale is set by cookie with no URL prefix.

---

## 6. Error handling

Three categories, handled differently.

**User-correctable** — wrong code, weak password, invalid email. Rendered inline on the field, in both languages, never as a toast.

**Transient** — email provider unavailable, Supabase timeout. These must never strand a user mid-signup. If the code email fails to send, the user still reaches the verify screen with a resend control and a plain explanation, and the failure is written to `auth_events` as `code_send_failed` so it is visible rather than silent.

**Unexpected** — caught by a route-group `error.tsx` boundary, so a crash in the app shell cannot take down the auth screens.

The one deliberate exception to friendly errors is identity: those responses are uniform in both message and timing, as described in section 4.

---

## 7. Testing

### The exit test

Two users in different organisations, and a raw SQL session proving neither can read the other's rows — executed against the database directly rather than through the application, because the property being tested is that RLS and not application code enforces tenancy.

### Auth integration tests

- An expired code is refused
- Five wrong attempts burn the code
- A `signup_verify` code is rejected at the device challenge
- A trusted device skips the challenge; an untrusted one does not
- Password reset revokes every trusted device
- Two parallel verifications of one code produce exactly one success (the row-lock race)
- Unknown email and wrong password are indistinguishable in message and timing

### Frontend tests

Playwright screenshots of every auth screen in four combinations: light and dark, LTR and RTL. An axe accessibility pass on each. A token audit asserting no hard-coded colour appears outside `globals.css`.

### Tooling

Vitest for unit and integration tests, Playwright for browser tests, Supabase local via the CLI so the suite needs no cloud project and no secrets.

---

## 8. Estimate

| Work | Days |
|---|---|
| Token system and UI kit | 2 |
| Supabase schema, RLS, JWT hook | 1–2 |
| Auth flows and screens | 3–4 |
| Tests and polish | 2 |
| **Total** | **8–10 working days** |

The design system is front-loaded because everything after it depends on the tokens existing. The largest single chunk is the auth flows.

---

## 9. Out of scope

Deferred deliberately, each to a named later sub-project:

- Google OAuth and any social login → sub-project 5
- Team management UI beyond accepting an invite → sub-project 5
- Active-sessions / device-manager screen → sub-project 5 (the `auth_events` and `trusted_devices` data it needs is written from day one)
- TOTP authenticator support → not planned; the email-code-on-new-device flow was chosen instead
- Everything in the document, analysis and chat pipelines → sub-projects 2, 3 and 4
