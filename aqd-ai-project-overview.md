# Aqd AI (عقد) — Full Project Overview & Rebuild Spec

A complete reference for an engineer who wants to study this project or rebuild it from scratch as practice.

**Live app:** https://aqd-ai-two.vercel.app
**Repo:** `JoeDagher/aqd-ai` · local path `D:\Work\Portifolio & Projects\claude data\aqd-ai`

---

## 1. What the product is

Aqd AI is a **bilingual (Arabic-first / English) AI contract-analysis SaaS** for legal teams, contract managers, and business owners in Kuwait and the Gulf.

The core loop:

1. **Upload** a contract (PDF or DOCX, Arabic or English).
2. The system **parses and segments** it into numbered clauses.
3. AI produces four outputs in parallel:
   - **Summary** of the contract
   - **Extracted key fields** (parties, dates, amounts, governing law…)
   - **Risk findings** — every clause scored against a legal *playbook* of rules, with severity (high/medium/low)
   - **Obligations calendar** — who must do what, by when
4. A **citation-locked chat** answers questions *only* from the document — every answer carries `[n]` citations that jump to (and flash) the source clause. If the answer isn't in the document, it must say `NOT_FOUND` rather than hallucinate.

Success criterion (from PRODUCT.md): *"a lawyer trusts the output enough to act on it."* Grounding and anti-hallucination are the product, not a feature.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Web framework | **Next.js 16** (App Router, Turbopack), **React 19** |
| Styling | **Tailwind CSS v4** with OKLCH design tokens in `globals.css` |
| i18n | **next-intl** — cookie-based locale, full Arabic RTL, all strings in `messages/{en,ar}.json` |
| Database | **Supabase** — Postgres 17, Row-Level Security multi-tenancy, **pgvector** (384-dim, HNSW index), private Storage bucket |
| Embeddings | Supabase **Edge Function `embed`** running the free `gte-small` model (384 dims) |
| LLMs | **OpenRouter** with a 3-tier model router: cheap (`gemini-2.5-flash-lite`), main (`gemini-2.5-flash`), heavy (`claude-sonnet-4.5`) |
| Parsing | `unpdf` (PDF), `mammoth` (DOCX) |
| Monorepo | pnpm workspaces: `apps/web`, `packages/shared`, `supabase/` |
| Hosting | Vercel (web) + Supabase cloud (DB/storage/edge) |

---

## 3. Repo layout

```
aqd-ai/
  apps/web/                     ← the Next.js app
    src/app/(auth)/             login, signup (split-panel AuthShell)
    src/app/(app)/              dashboard, contracts/[id], team, settings
    src/app/onboarding/         create-org flow after first signup
    src/app/actions/            server actions: auth, contracts, team, locale
    src/app/api/
      contracts/[id]/ingest/    parse → segment → chunk → embed
      contracts/[id]/analyze/   4 parallel AI tasks
      chat/                     SSE streaming RAG chat
    src/lib/ingest/             parse.ts, segment.ts, chunk.ts
    src/lib/ai/                 router.ts (tiers/retry/cost), prompts.ts, embed.ts
    src/lib/supabase/           client.ts (browser), server.ts (session client)
    src/components/             ui.tsx kit, contract-view, chat-panel, upload-zone…
    messages/{en,ar}.json       every UI string
  packages/shared/              shared types
  supabase/
    migrations/0001–0007.sql    schema, RLS, JWT hooks, vector search fn
    functions/embed/            gte-small embedding edge function
  qa/                           self-improving AI answer-quality harness
  scripts/sonnet-proxy.mjs      local OpenAI-compatible proxy backed by claude CLI
  aqd-plugin/                   Claude Code agents/skills that drive the QA loop
  PRODUCT.md / DESIGN.md / NEXT.md
```

---

## 4. Architecture — the three pipelines

```
upload (client → Supabase Storage DIRECT)        # bypasses serverless body limits
  └─ POST /api/contracts/[id]/ingest
       parse (unpdf/mammoth) → AR/EN clause segmentation
       → chunk (recursive splitter respecting clause boundaries)
       → embed via edge function → store vectors in pgvector
  └─ POST /api/contracts/[id]/analyze
       4 PARALLEL AI calls: summary / field extraction / playbook risks / obligations
       each result parsed independently (one bad JSON doesn't kill the rest)
       results cached by content_hash in `analyses`
  └─ POST /api/chat  (SSE)
       embed the question → match_chunks() vector search (org+contract scoped)
       → citation-locked answer streamed; citations persisted per message
```

Key engineering decisions worth copying:

- **Client uploads go straight to Storage**, not through the API — avoids Vercel's request-body limits on large PDFs.
- **Chunking cuts at clause boundaries**, so a retrieved chunk always maps cleanly to a citable clause.
- **Every AI task's JSON is parsed independently** — a malformed risks response still lets summary/fields/obligations land.
- **Analyses cache on `(org_id, content_hash)`** — re-analyzing an unchanged document is free.

---

## 5. Data model (16 tables, all carrying `org_id`)

**Tenancy:** `organizations`, `org_members` (roles), `invites` (token-based)
**Documents:** `contracts`, `contract_files` (checksum-deduped), `contract_versions`, `clauses` (trigram index for text search), `chunks` (384-dim `vector`, HNSW index)
**AI output:** `analyses` (cached by content hash), `extracted_fields`, `risk_findings`, `obligations` (indexed by due date)
**Playbook:** `playbooks`, `playbook_rules` (the seeded legal rulebook risks are scored against)
**Chat:** `chats`, `chat_messages`, `citations` (message → clause links)
**Ops:** `usage_events` (tokens + cost per AI call — survives contract deletion), `subscriptions`, `audit_log`

**Multi-tenancy design (the heart of the security model):**

- A **custom access token hook** (`custom_access_token_hook`) stamps `org_id` and `org_role` into the user's JWT at token mint.
- SQL helpers `jwt_org_id()` / `jwt_org_role()` read the JWT, with a **membership-table fallback** (migration 0004) for tokens minted before the hook ran.
- **RLS on every table** filters by `org_id`. Server routes always use the **user's session client — never a service-role key** — so the database, not application code, enforces tenancy.
- `create_organization()` and `accept_invite()` are `security definer` functions — the only writes that cross the tenancy boundary.
- `match_chunks()` is the vector-search RPC, also org-scoped.

---

## 6. AI layer

`src/lib/ai/router.ts` — the model router:

- **3 tiers** mapped to models via env-overridable config; per-model **pricing table** so every call logs input/output tokens and estimated USD cost into `usage_events`.
- **Hardened against OpenRouter's nastiest failure mode:** upstream rate limits come back as **HTTP 200 with an `error` object in the body** and truncated `content`. The router detects this (typed `AiUpstreamError`), retries with bounded backoff (4 attempts, 1s/2s/4s, `AI_RETRY_ATTEMPTS` override), and fails loudly on `finish_reason: "length"` for JSON tasks. Same detection exists in the streaming path (`aiStream`) for chat.
- `AiDisabledError` when no key — the app runs with AI features off rather than crashing.
- `OPENROUTER_BASE_URL` is overridable so the QA harness can point the *same production code* at a local proxy.

`src/lib/ai/prompts.ts` — the five task prompts (summary, fields, risks, obligations, chat). Hard rules baked in: `NOT_FOUND` when a value is absent (never invent), missing-REQUIRED-clause findings use `clause_id: null`, no computed dates, clause references by visible number, `[n]` citation format, Arabic outputs with `reason_ar` fields.

---

## 7. i18n / RTL — first-class Arabic

- Locale via cookie (next-intl), instant switch, no URL prefix.
- **Zero hardcoded strings** — everything in `messages/en.json` / `messages/ar.json`.
- **Logical CSS properties only** (`ms-/me-/ps-/pe-/text-start`) so RTL mirrors automatically.
- Per-clause `dir` attribute based on detected language — an English clause inside an Arabic contract renders LTR.
- Arabic typography tuned separately: IBM Plex Sans Arabic for UI, Amiri (Naskh) for display.

---

## 8. Design system (DESIGN.md)

"Refined legal-tech dark" — dark-only, deep ink-navy surfaces, teal as the single functional accent, brass as a brand-only signature (logo, clause numbers, citation flash — never on buttons).

- All colors are **OKLCH tokens** in `globals.css` (`--color-surface/-2/-3`, `--color-edge`, `--color-ink/-dim/-faint`, `--color-accent`, `--color-brass`, `--color-risk-high/medium/low`).
- **Risk severity is never color alone** — always paired with an icon/label (WCAG).
- UI kit lives in one file, `components/ui.tsx`: Button, Input, Select, Card, Badge, RiskPips, Spinner, plus the `LogoMark` (khatim-seal mark: two interlocked squares, a nod to the Gulf contract stamp ختم).
- Motion: 150–250ms, `clause-flash` (brass, 1.8s) when a citation jump lands, full `prefers-reduced-motion` fallbacks.
- Layout: sticky 240px sidebar app shell, `max-w-5xl/6xl` content, split-panel auth.

---

## 9. QA harness (`qa/`) — the most unusual part

A **self-improving answer-quality loop** that tests the *actual production AI code*:

```
run-analyst.mjs   runs prod prompts+router on a fixture contract
packet.mjs        bundles {ground truth + AI answers} for grading
RUBRIC.md         grading rubric; a Fable-5 grader agent scores per task
fixtures/*.json   contracts WITH answer keys (saas-en, procurement-ar)
out/              git-tracked verdicts per round
```

Loop: **test → grade → fix prompts.ts → retest** until every task ≥4/5 with zero high-severity misses. Two backends:

- Real OpenRouter key → true prod parity (tests Gemini).
- `scripts/sonnet-proxy.mjs` → an OpenAI-compatible local server backed by the `claude` CLI, so the loop runs keyless/offline.

**Current state (v5, real Gemini):** both fixtures score **4.4/5.0**, zero high-severity misses. Known prompt gaps: Gemini ignores the risk false-positive carve-out guard (flags standard confidentiality carve-outs as HIGH), and Arabic obligations leak English / name the wrong obligor. The planned fix (round 6) is promoting the guard to an enumerated hard precondition.

---

## 10. Known issues / open work (NEXT.md)

1. Apply v5 prompt fixes and run QA round 6 (exact wording in `qa/out/*.grade.v5-gemini.json`).
2. Only 2 QA fixtures — needs more.
3. Merge branch `fix/quality-review-2026-07-06` into `main` (main is 3 commits behind).
4. Large Arabic PDFs: ingest measured ~403s locally vs Vercel's 300s limit → possible 504s; needs `maxDuration` raise or chunked ingest.
5. Rotate the Supabase PAT and OpenRouter key (were pasted in chat earlier).
6. Untracked `pnpm-lock.yaml` — decide whether to commit.

---

## 11. Suggested rebuild roadmap (for practice)

A realistic phased path to build this from zero — each phase ships something testable:

**Phase 1 — Foundation & tenancy (the hardest 20%)**
Monorepo scaffold, Supabase project, migrations 0001–0002: orgs, members, invites, JWT custom-claims hook, RLS on everything. Auth pages + onboarding (create org / accept invite). *Exit test: two users in different orgs can never see each other's rows, verified with raw SQL.*

**Phase 2 — Document pipeline (no AI yet)**
Direct-to-Storage upload, ingest route: PDF/DOCX parse, AR/EN clause segmentation (regex over numbering patterns in both scripts), clause-bounded chunking. Contract view showing segmented clauses with per-clause `dir`. *Exit test: a bilingual PDF renders clause-by-clause, both scripts correct.*

**Phase 3 — Embeddings + retrieval**
Edge function with `gte-small`, pgvector HNSW, `match_chunks()` RPC. *Exit test: a keyword-free semantic query returns the right clause.*

**Phase 4 — Analysis**
Model router with tiers, retry, and cost logging (copy the 200-with-error-body lesson — it's a real prod bug class). Prompts for summary/fields/risks/obligations, 4 parallel calls with independent parsing, playbook tables + seeded rules, content-hash caching, usage_events. *Exit test: analyze a contract, delete nothing, re-analyze — second run is a cache hit.*

**Phase 5 — Citation-locked chat**
SSE route: embed question → retrieve → answer with `[n]` citations → persist messages + citations. UI: citation click scrolls + brass-flashes the clause; `NOT_FOUND` handling. *Exit test: ask something not in the document — it must refuse.*

**Phase 6 — Polish**
Full i18n pass (no hardcoded strings), design-token audit, obligations calendar view, print report, team management, dashboard.

**Phase 7 — QA harness**
Fixture contracts with answer keys, analyst runner reusing the prod router via `OPENROUTER_BASE_URL`, rubric, grade → fix-prompts → regrade loop.

**What makes this a good practice project:** it forces you through RLS multi-tenancy done right (JWT claims + no service key), RAG with *verifiable* grounding, resilient LLM error handling, true bidirectional i18n, SSE streaming, direct-to-storage uploads, and eval-driven prompt engineering — each of which is a skill employers actually probe for.
