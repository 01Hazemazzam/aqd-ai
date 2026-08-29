# Sub-project 3 & 4 — running quality findings log

Maintained against the reviewer checklist given for this validation. Updated as testing
continues; entries are not removed when fixed, only marked so the history of what broke stays
visible. "Verified" means confirmed against a real Gemini call through the actual production
path (`analyzeContract`), not a mock and not an isolated script, unless noted otherwise.

## Legend
🔴 open · 🟡 fixed, not yet re-verified live · 🟢 fixed and verified live · ⚪ observed, not a defect

---

### Factual accuracy
🟢 No fabricated dates, parties, amounts, or legal conclusions observed across 3 fixtures × 4
tasks × 2 full validation rounds (6 real end-to-end runs total, one contract run 3 times).

### Extraction reliability
🟢 `parties`, `effectiveDate`, `termLength`, `governingLaw`, `totalValue` extracted consistently
and correctly across English, Arabic, and mixed fixtures, including a governing-law fact that
only existed in an Arabic-only clause of an otherwise English-titled contract (cross-language
extraction, not just per-clause-language echo).

### Risk accuracy — false positives / missed risks
🟢 **Fixed and verified live, 3 independent runs.** Original bug: the risks prompt let the model
apply a rule about an *existing, badly-worded* clause (`auto_renewal_notice`,
`unilateral_amendment`, `indemnification_balance` — all "if this clause type exists and is
one-sided" rules) to a clause type's mere *absence*. Confirmed as real false positives on the
Arabic fixture (1 FP) and the mixed fixture (3 FPs) in the first validation round. Prompt fix
added (explicit examples naming the affected rules, explicit "absence is not a violation of
these rules" instruction). Re-verified in round 2 on both fixtures through the full production
path: Arabic fixture now returns exactly the 2 ground-truth findings
(`governing_law`, `dispute_resolution`), mixed fixture returns exactly 1
(`confidentiality`) — zero false positives on either, both matching ground truth exactly.
⚪ One judgment-call finding observed inconsistently across runs: `unlimited_liability` fired
once (not on the repeat run) for a clause that caps only one party's liability with no
reciprocal cap for the other. Defensible under the rule's own "unlimited **or one-sided**"
wording, but its presence/absence varied run-to-run on an otherwise-identical prompt — see
Output consistency below.

### Risk reasoning
🟢 Every finding observed carried a `reason` traceable to either a specific clause's actual text
or, for missing-clause findings, a plain statement of what's absent — no generic or non-grounded
reasons seen.

### Severity consistency
🟢 Same rule (`termination_clause`, `governing_law`, `dispute_resolution`) produced the same
severity (high/medium/low respectively) across multiple runs and multiple fixtures. No
same-rule-different-severity inconsistency observed. Sample size is still small (one rule
repeated 3x, most others 1-2x) — not a large-sample guarantee.

### Clause mapping
🟢 Every risk/obligation `clauseId` observed either matched a real clause id belonging to the
contract being analyzed, or was correctly `null` for a missing-clause finding. The code also
enforces this independently: `analyze-actions.ts` filters findings against the real clause id set
before insert, so even a hallucinated id could not reach the database — defense in depth, not
solely trusting the model.
🟢 **Fixed and verified.** Original bug: `summaryPrompt`/`fieldsPrompt` received the same
`[id=uuid]`-tagged clause text as `risksPrompt`/`obligationsPrompt`, and a real summary quoted
raw UUIDs verbatim in user-facing prose. Fixed by not giving those two tasks ids their JSON
schema has no field for. Re-verified live, round 2: fresh Contract A summary contains zero UUID
patterns.

### Missing information (NOT_FOUND discipline)
🟢 `governingLaw`/`totalValue` correctly `null` in every fixture where the source genuinely
lacks that fact (verified: Contract A has no stated fee amount, correctly `null`; Contract A has
no governing-law clause, correctly `null`). No case observed where a null-worthy field was
instead guessed or computed.

### Obligation accuracy
🟢 Obligor, action, and due date/trigger all correctly grounded across all 3 fixtures in every
run, including correct per-language obligor naming in the mixed fixture (`المعالج` for
Arabic-clause obligations, `Processor` for the English-clause one — the model followed each
clause's own language rather than normalizing to one).

### Arabic quality
🟢 **Fixed and verified live, round 2.** Original bug: an Arabic summary correctly wrote in
Arabic but left the English word "clause" untranslated in its citations. Root-caused to two
things: (1) the shared clause-rendering helper's parenthetical marker used the English word
"clause" as an exemplar, echoed back by the model; (2) no explicit language-consistency rule
existed. Both fixed (language-neutral marker + explicit rule); re-verified on a fresh Contract B
run — zero occurrences of the English word "clause" in the regenerated Arabic summary.
🟢 Party identification, obligor identification, and clause references all correct in Arabic
script throughout, no unnecessary English leakage observed elsewhere.
⚪ **Not a defect, tracked for a second data point:** one run of the mixed fixture's summary
rendered a number as "ثلاث0" (a stray literal `0` mixed into the Arabic word for "three") instead
of "ثلاثين" (thirty) or "٣٠". The same fact was correctly rendered elsewhere in the same
analysis's structured `obligations` JSON, so this is a free-text generation glitch, not a wrong
fact. **Did not reproduce on a second live run of the same fixture** — appears to be an
intermittent generation artifact rather than a systemic prompt/parsing bug. No fix applied;
watching for recurrence.

### Output consistency (same input, repeated analysis)
🟡 **Partially open.** Structural/factual content (fields, obligation grounding, the 2-3 clearly
rule-satisfying-or-violating risk findings) was stable across every repeat run observed.
**However**, the one genuinely borderline risk finding (`unlimited_liability` on the Arabic
fixture, the "one-sided liability cap" reading) appeared on one run and not on an otherwise
identical repeat. This is expected for a judgment call at the edge of a rule's wording, not a
bug — but it means two calls to "the same" analysis can differ on genuinely close cases. Not
fixed; documented as an inherent property of a non-deterministic model on ambiguous input, to
set expectations rather than promise byte-identical repeat analyses.

### JSON/schema reliability
🟢 **Fixed and verified live, round 2 (3rd independent confirmation of this exact fix).**
Original bug: a real 3267-output-token risks response failed strict `JSON.parse` with "Bad
Unicode escape in JSON" — a malformed escape inside Arabic `reasonAr` text — silently discarding
7 correct findings and leaving the analysis looking like the model had found nothing. Root cause
was two-layered: the parse failure itself, and a bare `catch {}` in `runTask` that discarded the
real error with no log line, which is why this took real debugging effort to even locate. Fixed:
`extractJson` retries with a stray-backslash repair pass before giving up (unit-tested against
the exact failure shape); `runTask` now logs the real error. Re-verified live three times across
two validation rounds: Contract A's 7 risk findings persisted correctly every time.

### Partial failure handling
🟢 Confirmed for real (not just mocked): on Fixture A's very first live run, `summary` succeeded
while `fields`/`risks`/`obligations` all failed (429s) in the same batch, and the partial result
(`status: 'ready'`, only `summary` populated, others left `null`) persisted correctly instead of
the whole analysis being discarded or left permanently `pending`.

### Provider resilience
🟢 Real `429 RESOURCE_EXHAUSTED` and real `503 UNAVAILABLE` both observed live and handled
correctly (caught, logged, non-crashing, sibling tasks unaffected).
🟡 Safety-content-block and `MAX_TOKENS` truncation handling is mocked-only — not reliably
forceable against a real API on demand. Mocked tests use response shapes matching Google's
documented format and the real 429/503 bodies actually observed (verbatim-shaped), but the
block/truncation branches themselves are not live-confirmed.
🔴 **Real, unresolved finding, not a code defect but a planning one:** the free tier's
`main`-tier model quota (`gemini-flash-latest` → `gemini-3.7-flash`) was exhausted by early
smoke-testing on day 1 and **was still exhausted on day 2** when re-checked directly. Either the
reset window is longer than 24h, the per-model daily cap is stricter than the documented 20/day
for this specific model/account, or there's an account-level throttle. Recommend the user check
https://ai.dev/rate-limit directly, or use a paid tier, before relying on same-day main-tier
testing.

### Caching
🟢 Verified live, round 1: re-analyzing an already-`ready` contract with an unchanged content
hash returned in 147ms with zero new `usage_events` rows, vs. 7-22s and 4-5 new rows for a real
run.

### Security / RLS
🟢 No service-role key used anywhere in this validation. Real two-org Postgres test
(`tests/ai/schema-integration.test.ts`) confirms `analyses`/`risk_findings`/`usage_events` are
fully invisible cross-org and a cross-org insert is rejected by RLS itself, not application code.

### User-facing quality
🟢 **Fixed and verified** (see Clause mapping above — same fix, same evidence): no internal
clause UUIDs, model artifacts, or implementation details observed in any user-facing text across
2 full validation rounds.

### Model naming / reproducibility (raised in the second review round)
🟢 **Fixed and verified.** Original gap: the router recorded the *requested* model string (which,
for the rolling-alias defaults, is not the model that actually served the request) in
`usage_events`, making a QA result impossible to trace back to a specific model version later.
Fixed: both `callAnthropic` and `callGemini` now prefer the response body's own resolved-model
field (`body.model` / `body.modelVersion`) over the requested alias. Verified live: round-2 runs
show `usage_events.model = "gemini-3.5-flash-lite"` (the concrete resolved snapshot), not
`"gemini-flash-lite-latest"` (the alias requested). **Policy decision, not a further code
change:** keep rolling aliases as the code default (they're what actually prevented the original
404-on-retirement bug), and rely on this per-call resolved-model capture for QA traceability
instead of pinning a version number in code — a pinned version is exactly what broke on day 1 of
this validation. Anyone repeating this evaluation should record the resolved model from
`usage_events` (or the run's console output) alongside the results, not just the alias name.

---

## Sub-project 4 — citation-locked chat

### Citation accuracy / no ambiguity
🟢 **Verified live.** Citation ordinals are assigned by *retrieval order* (`renderRetrievedClauses`
numbers matched clauses 1..N), never the document's own `clause_number` — so a `[1]` in the
model's answer always maps unambiguously to "the first clause `match_clauses` returned for this
question," not to a document-relative number the model could misremember. `route.ts` also
independently filters any citation ordinal the model emits down to the actual 1..N retrieved-set
range before persisting — a hallucinated `[7]` when only 3 clauses were retrieved is dropped, not
trusted. Live click-through confirmed: `[1]` in a real streamed answer scrolled to and flashed
exactly the clause it was grounded in.

### NOT_FOUND discipline
🟢 **Verified live.** A question with no supporting clause in the fixture (termination terms,
which Contract A's fixture deliberately omits) correctly returned the exact NOT_FOUND sentinel,
rendered client-side as the localized "not stated in the contract" message — not a guess, not a
generic refusal. Retrieval-level short-circuit also confirmed in code: zero `match_clauses` rows
skips the model call entirely and returns NOT_FOUND without spending a generation call.

### Provider resilience (streaming-specific)
🟡 **Partially verified.** Real 200 responses with real token streaming confirmed live on the
`cheap`-tier override (see Model tier coverage below). Mid-stream failure modes (connection drop
after some tokens already sent, a safety block arriving as a stream event rather than upfront)
are not live-forced — same limitation already logged for non-streaming calls in Sub-project 3's
Provider resilience entry. `streamGeminiText` throws loudly (not silently) if a tier resolves to
Anthropic, since Anthropic's SSE shape isn't implemented — this is a deliberate scope boundary,
not a bug, and is unit-tested.

### Output consistency (streaming/chat-specific)
⚪ Not independently re-tested for chat beyond the general non-determinism already documented for
generation calls in Sub-project 3 — no chat-specific consistency issue observed, but sample size
is small (one fixture, one question set, single live pass per question).

### Security / RLS (chat-specific)
🟢 Verified via real two-org Postgres test (`tests/chat/schema-integration.test.ts`, no API key
required for this half): `chats`/`chat_messages`/`citations` all correctly invisible cross-org,
the one-chat-per-contract uniqueness constraint enforced, RLS rejects cross-org access at the
database layer. `match_clauses()` is a plain SQL function (not `security definer`), so it inherits
the caller's session and the existing `clauses` RLS automatically — confirmed live: the same
query against the same contract returns real ranked matches for the owning org and zero rows for
a different org.

### Two real bugs found (both fixed, both regression-tested)
🟢 **CRLF SSE framing.** `streamGenerateContent?alt=sse` sends `\r\n\r\n` frame separators, not
bare `\n\n`. The request succeeded (200, real `usageMetadata` logged) but the frame-splitting
`buffer.split('\n\n')` never matched a single frame, so zero token chunks were ever yielded —
a silent failure, not a thrown error, found only by inspecting the raw stream bytes directly
(`text.includes('\r\n')`). Fixed with a `.replace(/\r\n/g, '\n')` normalization pass before
buffering. Regression-tested in `tests/ai/router.test.ts`: exact-CRLF case, bare-LF fallback case
(so a provider that *doesn't* use CRLF still works), and a frame deliberately split across
multiple `read()` calls.
🟢 **i18n namespace mismatch.** `useTranslations('contracts.chat')` (two-level dot-path) silently
failed to resolve every key in the chat panel, throwing `MISSING_MESSAGE` at render time. Every
other component in this codebase uses the one-level-namespace-plus-nested-key form
(`useTranslations('contracts')` + `t('errors.xxx')`); the chat panel was the one place that broke
the established pattern. Fixed by matching it. No regression test added (this is a
component-render-time i18n key lookup, not unit-testable without a full render harness this
codebase doesn't otherwise use) — flagged here instead as a "match the existing pattern" note for
anyone adding the next `useTranslations` call.

### Model tier coverage (chat-specific — same caveat as Sub-project 3)
🔴 **Still a known validation gap, not a claim of full coverage.** Re-checked in QA pass 2 (below):
`main` tier (`gemini-flash-latest` → resolved `gemini-3.7-flash`) was available at the very start
of that pass — one direct call succeeded — but returned `429 RESOURCE_EXHAUSTED` on the next real
call attempted seconds later, before any chat-specific `main`-tier verification could be done. This
is the same unexplained quota behavior already on record above (quota exhausting far faster than
the documented 20/day figure would suggest), now reproduced a second time on a different day. The
rest of QA pass 2, like round 1, ran on the `cheap`-tier override
(`AI_MODEL_MAIN=gemini-flash-lite-latest`, reverted afterward, dev server restarted back to
defaults both times). `main` tier's actual chat behavior (streaming shape, citation quality,
NOT_FOUND discipline, cross-language answer correctness) remains **not independently verified**.
`heavy` tier (Anthropic) is out of scope for chat entirely — `streamGeminiText` explicitly throws
if a tier resolves to a non-Gemini provider, since no Anthropic streaming implementation exists
and no Anthropic key has ever been configured in this environment. Embedding generation
(`embed.ts`, `gemini-embedding-001`) was exercised on whatever tier/quota was live at the time and
is model-fixed (not tier-selectable), so this gap is specific to the *generation* step of chat,
not retrieval. **Re-checked a third time at the start of QA pass 3** with the same one-call-then-429
result — quota still exhausts almost immediately on `main`, on a third distinct day. This is now a
consistent, reproducible pattern rather than a one-off, but the *cause* remains unexplained (see the
original entry above). Tracked as an open QA item for the eventual release, not a blocker for
Sub-project 5 — per explicit instruction, development is not gated on same-day `main`-tier
availability.

---

## Sub-project 4 QA pass 2 — targeted chatbot validation

Scope: cross-contract isolation, multi-clause citation correctness, the wrong-citation guard,
ambiguous/irrelevant questions, Arabic/English/mixed-language grounding, and repeat-question
stability. Ran against the three same-org QA fixtures (`QA-EN`, `QA-AR`, `QA-MIX` — all in
"Walkthrough Test Org", the same org used for round-1's live click-through) via the actual running
app in the browser, with every answer and citation cross-checked directly against Postgres, not
just read off the rendered page.

### Cross-contract isolation
🟢 **Fixed test gap, verified two ways.** Round 1 only proved cross-*org* isolation
(`match_clauses` returns nothing for a different org). It never proved cross-*contract* isolation
within the *same* org, which is the boundary that actually matters day to day (one org, many
contracts). Added a same-org second-contract fixture to
`tests/chat/schema-integration.test.ts` and confirmed `match_clauses` never crosses the
`contract_id` boundary even when the sibling contract's clause is the better semantic match for
the query. Also confirmed live: asked `QA-EN`'s chat "What is the consulting fee in Kuwaiti
dinars under this agreement?" — a fact that exists verbatim in the same org's `QA-AR` contract
(25,000 KWD) but nowhere in `QA-EN` — and got `NOT_FOUND`, not the leaked figure.

### Multi-clause questions and citation correctness
🟢 **Verified live, English and Arabic.** "What are the payment terms, and does this agreement
automatically renew?" against `QA-EN` correctly cited both `[3]` (Fees, real `clause_number` 5)
and `[1]` (Automatic Renewal, real `clause_number` 4) — verified by joining the persisted
`citations` rows back to `clauses`, not just by reading the rendered `[n]` markers. Same result in
Arabic against `QA-AR` for a termination-notice + fee question: `[1]` → the termination clause,
`[3]` → the fee clause, both correct.

### Wrong-citation guard ("cannot persist a wrong citation")
🟢 **Verified by extraction + unit test, not by trying to organically provoke the model.** The
ordinal-range filter that drops any `[n]` outside the retrieved set already existed in `route.ts`
but was inline and untested directly. Extracted it into `resolveCitations()`
(`src/lib/ai/prompts.ts`) and unit-tested it directly: a hallucinated ordinal outside the retrieved
range is dropped and never reaches the `citations` insert, a mix of one valid and one invalid
ordinal keeps only the valid one, and a repeated valid ordinal dedupes to one row. This is a
stronger guarantee than trying to get a live model to emit a bad citation on demand (unreliable to
force, and a pass wouldn't prove the *next* run is also safe) — the range check is enforced in
code regardless of what the model outputs.

### Ambiguous / irrelevant questions
🟢 **Verified live, English and Arabic.** "What data privacy or GDPR obligations does this
agreement impose?" against `QA-EN` (no such clause) → `NOT_FOUND`. "هل يشمل هذا العقد شرط عدم
المنافسة؟" (does this contract include a non-compete clause?) against `QA-AR` (no such clause) →
`NOT_FOUND`. No guessing, no generic filler answer in either case.

### Arabic / English / mixed-language grounding
🟡 **One real bug found and fixed.** Arabic question against `QA-AR` (native-language fixture):
correct, fully Arabic answer, no English leakage. Arabic question against `QA-MIX`'s English
clause (data security measures): correctly retrieved the English clause and correctly answered in
Arabic, matching the question's language. **English question against `QA-MIX`'s Arabic clause**
(how long the Processor must retain/delete data): retrieval was correct (the right clause every
time), but the answer came back in **Arabic**, mirroring the clause's language instead of the
question's language — reproduced twice, not a one-off. `chatPrompt`'s existing instruction ("write
your answer in the same language as the question") wasn't explicit enough about which language
wins when the grounding clause is in a *different* language than the question. Fixed by naming the
conflict directly in the prompt, with the exact failing case as a worked example. Re-verified live
after the fix: the same English question against the same Arabic clause now gets a correct English
answer that still cites the same clause. Regression-tested in `tests/ai/prompts.test.ts`.

### Repeat-question stability
🟢 **Facts and citations stable; exact wording varies slightly, as already documented for the
analysis layer.** Same English question against `QA-EN`, asked twice: byte-identical answer text
and identical citation mapping both times. Same Arabic question against `QA-AR`, asked twice:
identical facts and identical citations (`[1]`/`[3]` → the same two clauses both times), with a
trivial wording difference between runs ("والأتعاب..." vs "أما الأتعاب... فهي..." — same meaning,
different connector). The `QA-MIX` cross-language question was also asked twice before the
language fix and was stable in its own way — wrong (Arabic) both times, same wording both times —
which helped confirm the bug was systematic rather than a one-off generation fluke.

### New bug: `streamGeminiText` had no retry logic
🟢 **Found while re-running the multi-clause question, fixed, regression-tested.** The very first
live request in this pass failed outright with `429 RESOURCE_EXHAUSTED` and the client showed
"Something went wrong answering that." Direct reproduction against the real API showed Google's
own error body advertised a **~6 second** retry delay — a transient, recoverable throttle, not a
hard stop. But `streamGeminiText` had no retry loop at all, unlike every other AI call path in the
app (`aiComplete` retries retryable failures with exponential backoff). Fixed by adding a retry
loop around the *initial* request only (`fetchStreamWithRetry` in `src/lib/ai/router.ts`) — once
streaming has actually started and tokens may already be on their way to the client, a failure is
not retried, matching the existing behavior for mid-stream errors. Regression-tested: retries a
429 and streams normally once a later attempt succeeds, gives up after exhausting attempts on a
persistent 429, and does not retry a non-retryable failure (e.g. 400).

---

## Sub-project 4 QA pass 3 — final focused check before Sub-project 5

Scope: contract_id + org_id retrieval scoping, a 2-3 clause end-to-end citation check, an
adversarial "semantically close but factually absent" NOT_FOUND test, re-confirming the
cross-language fix from pass 2 with fresh examples in both directions, a long streamed answer's
citations surviving stream completion, and refresh/reopen behavior. `main` tier checked again
first (see Model tier coverage above — still exhausted almost immediately); rest of this pass ran
on the `cheap`-tier override, reverted afterward.

### Retrieval scoped to both contract_id and org_id
🟢 **Verified by code review + existing tests, no gap found.** `match_clauses()` filters
`contract_id` explicitly in its `where` clause (`supabase/migrations/0012_chat.sql`), and — because
it is plain SQL, not `security definer` — the `clauses_org_all` RLS policy (`org_id =
jwt_org_id()`) applies to every row it scans on top of that, scoping by org even though the
function's SQL never mentions `org_id` itself. `route.ts` adds a third layer before retrieval even
runs: the initial `contracts` lookup is itself RLS-gated, so a `contractId` from another org 404s
before `match_clauses` is ever called. The contract_id dimension is proven by pass 2's new
same-org cross-contract test; the org_id dimension is proven by pass 1's cross-org test. Both
dimensions are independently covered — no single test proves both at once, but the combination of
the two, plus the RLS policy definition itself, is a complete proof, so no new test was added.

### 2-3 clause end-to-end citation check
🟢 **Verified live.** "What are my confidentiality, indemnification, and liability obligations
under this agreement?" against `QA-EN` produced a 3-paragraph answer citing `[1]` (Confidentiality,
real `clause_number` 6), `[2]` (Indemnification, `clause_number` 8, cited twice in the text), and
`[3]` (Limitation of Liability, `clause_number` 7) — all three verified by joining the persisted
`citations` rows back to `clauses`. The repeated `[2]` citation persisted as a single deduplicated
row, live confirmation of `resolveCitations`'s dedup behavior (unit-tested in pass 2) actually
firing in the real request path.

### Adversarial NOT_FOUND (semantically close, factually absent)
🟢 **Verified live, English and Arabic, on two different fixtures.** `QA-EN`: "What interest rate
or late-payment penalty applies if Licensee pays an invoice after the due date?" — the Fees clause
(payment terms, 30-day due date) is the obvious semantic neighbor and was almost certainly in the
retrieved set, but it states no penalty or interest rate, and the answer was `NOT_FOUND`, not a
fabricated rate. `QA-AR`: "ما هي نسبة الفائدة على التأخر في سداد الأتعاب؟" (what interest rate
applies to late payment of fees) against the fee clause (a flat 25,000 KWD lump sum, no interest
mentioned) — also correctly `NOT_FOUND`. Confirms the model isn't defaulting to "use the nearest
retrieved clause anyway" when the specific fact asked for isn't actually stated in it.

### Cross-language fix re-confirmed (fresh examples, both directions)
🟢 **Holds.** Re-tested pass 2's fix with two new question/clause pairs on `QA-MIX`, not the same
ones already covered: an English question about governing law/jurisdiction, grounded in Arabic
clause 6, correctly answered in English ("This agreement is governed by the laws of the United
Arab Emirates, and the Dubai courts have jurisdiction..." `[1]`). An Arabic question about the
liability cap, grounded in English clause 5, correctly answered in Arabic. Both directions correct,
both citations verified against the real clause.

### Long answer / citations survive stream completion
🟢 **Verified live** (same run as the 2-3 clause check above — a 3-paragraph, 3-citation answer is
also a good long-stream case). The full answer text persisted intact in `chat_messages.content`
(not truncated or cut off mid-stream), and all citations were correctly resolved and inserted only
after the stream's `done` event, per `route.ts`'s existing design (`persistAndClose` runs once,
after the full text has accumulated, not per-token) — confirmed by the persisted row containing the
complete 3-paragraph text with citation markers intact for all three `[n]` positions.

### Refresh / reopen
🟡 **Real gap found: data is correct, the UI does not show it.** Reloading a contract page whose
chat already has messages and citations shows a completely empty chat panel — not stale data, not
wrong data, just nothing, as if the conversation never happened. Confirmed this is a UI-only gap,
not a data problem: querying `chat_messages`/`citations` directly for the same contract immediately
after the reload shows every prior message and citation fully intact and still correctly linked to
its real clause. Root cause is by design, not a regression: `ChatPanel` (`chat-panel.tsx`)
initializes `useState<ChatMessage[]>([])` and has no fetch-on-mount; `page.tsx` never queries
`chat_messages` server-side either. There is currently no code path anywhere that loads existing
chat history into the UI — the panel has only ever been exercised as a single-session, ask-and-see
experience. **Not fixed this round** — this is a real (if small) feature addition, not a
same-shape bug fix like the CRLF/retry/language issues found in earlier passes, so it's flagged
here as a tracked gap for a deliberate decision rather than folded into "chatbot bug fixes."

---

## User-reported "critical grounding/isolation issue" — investigated, not a real leak

The user independently built a 26-clause "chatbot grounding stress-test" contract and reported,
from their own separate manual testing against the same shared dev environment: `QA-EN`'s chatbot
answered a governing-law question with "UAE law, Dubai courts" (a contract with no governing-law
clause at all) and answered a liability question with a "KWD 18,600" cap (`QA-EN`'s real liability
clause states unlimited liability). They asked for root cause before any fix, with exact
contract/clause IDs traced, plus explicit regression tests and two Arabic-quality fixes.

### Investigation (systematic root-cause process, evidence before any fix)
🟢 **No cross-contract leak found, in either the backend or the client.** Two independent
mechanisms were checked and ruled out:
- **Full DB audit.** Searched every `chat_messages` row in the entire database (not just `QA-EN`)
  for "UAE"/"Dubai"/"18,600". Exactly one match existed anywhere: an assistant message on
  **`QA-MIX`** (not `QA-EN`), generated during this session's own QA pass 3 testing, correctly
  citing `QA-MIX`'s own real clause 6 (`القانون الحاكم: ...قوانين دولة الإمارات العربية
  المتحدة...`). "18,600" appeared **nowhere** in the database at all. `QA-EN`'s entire chat
  history (every row, chronological) contains no governing-law answer of any kind — every
  governing-law-adjacent question on `QA-EN` correctly returned `NOT_FOUND`. The user's new stress-
  test contract's own chat has exactly one row: their question, with **no assistant response at
  all** (matches their screenshot showing "Something went wrong answering that" — a real,
  already-tracked main-tier `429 RESOURCE_EXHAUSTED`, confirmed in the dev server log at the same
  timestamp, not a wrong answer).
- **Live client-side navigation test.** The user explicitly asked to check for stale chat state
  reused after switching contracts. Reproduced directly: typed a marker string into `QA-MIX`'s chat
  input, clicked "Back to contracts" (a real Next.js `<Link>`, not a hard reload), then clicked into
  `QA-EN` the same way. `QA-EN`'s chat panel rendered completely fresh — no leftover marker text, no
  leftover messages. Next.js App Router fully remounts `ChatPanel` on a dynamic-segment change via
  client-side `<Link>` navigation; no React state survives the switch.
- **Retrieval trace, as explicitly requested.** `match_clauses` for `QA-EN`
  (`bc02f8f0-acae-4001-81da-ecba4c33800f`) on "What is the governing law of this agreement?" returns
  only `QA-EN`'s own 6 clause ids (Indemnification, Amendments, Parties, Liability, Term, Renewal —
  all ~0.58 similarity, no strong match, since the fact genuinely isn't there); `QA-MIX`'s governing
  law clause id never appears.

**Most likely explanation:** a misattribution, not a system defect — the "UAE/Dubai" answer the
user saw was this session's own correct `QA-MIX` result, and the "18,600" figure does not
correspond to anything the system ever actually produced. No code changed as a result of the
investigation itself.

### Regression tests added anyway (the guarantee is now durable, not just re-derived by inspection)
🟢 New file `tests/chat/grounding-isolation.test.ts`, real embeddings + real generation against two
fresh same-org fixtures built specifically to make a leak obvious (`Iso Test EN` — unlimited
liability, no governing-law clause at all, mirroring `QA-EN`; `Iso Test Sibling` — a governing-law
clause naming Ireland/Dublin and a liability clause naming exactly "KWD 18,600", so any leak of
either fact is unambiguous, not a coincidental phrase match). All 3 pass live: governing-law
question → `NOT_FOUND`, retrieved set never contains the sibling's clause; liability question →
correctly reflects "unlimited", never the sibling's numeric cap; a 3-question set never surfaces
"Ireland"/"Dublin"/"18,600" in any answer. Uses tier `main` to match `route.ts` exactly, so — like
every other real-generation test in this suite — it fails on a 429 whenever `main` is already
quota-exhausted; confirmed passing under the same `cheap`-tier override used throughout this
project's QA passes.

### Two real, unrelated bugs found and fixed during this same investigation
🟢 **Hebrew/Arabic character homoglyph.** A real stored `QA-EN` summary contained a single Hebrew
character (`ר`, U+05E8, "resh") standing in for its visually near-identical Arabic counterpart
(`ر`, reh, U+0631) in the middle of an otherwise-correct word — a generation-time script mix-up,
confirmed by direct codepoint inspection of the stored text. Fixed with a narrow, evidence-based
`repairHebrewArabicHomoglyphs()` in `src/lib/ai/prompts.ts` (only the one confirmed pair, not a
broad Hebrew-range strip that could damage legitimate text) applied in `extractJson` (summary/
fields/risks/obligations) and on the final persisted chat answer in `route.ts`. Regression-tested;
does not touch the character in the middle of a live token stream, only the persisted/re-rendered
text, since buffering every token to scan for one rare character isn't proportionate.
🟢 **"Exhibit A" mistranslated as "المعرض A".** The same stored `QA-EN` summary translated "Exhibit
A" as "المعرض A" — literally "the exhibition/gallery A", wrong legal terminology for a document
reference. Added an explicit instruction to `HARD_RULES` and `chatPrompt` naming this exact wrong
translation, so document-defined references (Exhibit A, Schedule 1, etc.) are kept as-is rather
than translated as ordinary nouns. Live-verified against a synthetic Arabic clause referencing
"Exhibit A": before the fix this is the same failure mode already observed; after the fix, the
regenerated summary correctly kept "Exhibit A" untranslated. Regression-tested in both
`summaryPrompt` and `chatPrompt`.

### Observed but not investigated further this round
⚪ A prior `QA-EN` summary (all-English contract) was written entirely in Arabic — linguistically
unexpected but not incorrect per se (no rule requires matching the *majority* language of a
multi-clause document, only each clause's own language, and a summary spans all clauses). Not
reproduced on the verification re-run for this investigation, which correctly produced an English
summary for the same all-English contract. Noted here rather than chased, since it's outside the
scope of the reported issue and didn't reproduce.

---

## Regression tests added (locking in fixes found during this validation)

- `tests/ai/prompts.test.ts` — stray-backslash JSON repair (exact failure shape)
- `tests/ai/prompts.test.ts` — summary/fields prompts don't leak clause ids
- `tests/ai/prompts.test.ts` — risks/obligations prompts do carry clause ids (positive case, so
  the leak fix can't be "fixed" by breaking id-passing for the tasks that need it)
- `tests/ai/prompts.test.ts` — risks system prompt names the absence-vs-imbalance distinction
  with the specific rules that broke
- `tests/ai/prompts.test.ts` — summary prompt instructs Arabic-language consistency and the
  clause-number marker carries no English exemplar
- `tests/ai/router.test.ts` — both providers record the response's resolved model, not the
  requested alias
- `tests/ai/schema-integration.test.ts` — real-Postgres RLS isolation (pre-existing, still
  covers the new analyses/risk_findings/usage_events tables)
- `tests/ai/router.test.ts` — SSE CRLF frame format, bare-LF fallback, and a frame split across
  multiple stream reads
- `tests/ai/embed.test.ts` — pgvector string formatting, batching >100 texts into multiple calls,
  retry-then-succeed, and the disabled/empty-input short-circuits
- `tests/chat/schema-integration.test.ts` — real-embeddings semantic ranking via `match_clauses`,
  cross-org invisibility of matches, and RLS for chats/chat_messages/citations (create/read/insert,
  one-chat-per-contract, cross-org isolation)
- `tests/chat/schema-integration.test.ts` — cross-contract isolation within the same org: a second
  contract's clause is never returned by `match_clauses` for the first contract's id, even when it
  is the better semantic match, and vice versa
- `tests/ai/prompts.test.ts` — `resolveCitations` maps every valid ordinal to its real clause,
  drops out-of-range/hallucinated ordinals (the "wrong citation can't persist" guarantee), handles
  a mix of valid and invalid ordinals, and dedupes a repeated valid ordinal
- `tests/ai/prompts.test.ts` — `chatPrompt` explicitly instructs answering in the question's
  language even when the grounding clause is in a different language, with the exact failing case
  (English question, Arabic clause) as a worked example
- `tests/ai/router.test.ts` — `streamGeminiText` retries a retryable initial-request failure (429)
  and streams normally on a later success, gives up after exhausting attempts on a persistent 429,
  and does not retry a non-retryable failure
- `tests/chat/grounding-isolation.test.ts` (new) — real embeddings + real generation, two fresh
  same-org fixtures: a governing-law question on the fixture with no such clause returns
  `NOT_FOUND` and never retrieves the sibling contract's clause; a liability question correctly
  reflects the fixture's own "unlimited" clause, never the sibling's numeric cap; a 3-question set
  never surfaces the sibling contract's facts in any answer
- `tests/ai/prompts.test.ts` — `repairHebrewArabicHomoglyphs` normalizes the exact observed Hebrew
  resh / Arabic reh substitution, leaves ordinary Arabic and English text untouched; `extractJson`
  applies it before parsing so the parsed value comes out clean
- `tests/ai/prompts.test.ts` — `summaryPrompt` and `chatPrompt` both instruct preserving
  document-defined references like "Exhibit A" instead of mistranslating them as ordinary nouns

Not regression-tested (impractical without live-model calls each run): the live model-quality
findings themselves (false-positive rate, extraction accuracy, Arabic fluency). These are the
kind of thing `qa/fixtures/*.json` + `qa/seed-fixture.mjs` exist for — re-run by hand against a
real key when the prompts or playbook change materially, not on every CI run.

---

## User-reported "analysis pipeline is broken" + PDF extraction defects — investigated to root cause

Reported against a new fixture, `Aqd_AI_Advanced_Contract_Test.pdf` (28 clauses, English with one
deliberately Arabic clause), now committed at `tests/fixtures/advanced-contract-test.pdf`. Root-cause
investigation traced the full path (contract → `analyzeContract` → environment → Gemini request →
response → parsing → DB write → UI) with hard evidence at every step before any fix, per explicit
instruction not to guess or patch symptoms.

🟢 **Analysis pipeline: not broken — genuine `main`-tier quota exhaustion, hidden behind a generic
error.** A direct, minimal request to `gemini-flash-latest` (the `main` tier's default, unmodified —
no stale `.env.local` override was present) using the app's real `GEMINI_API_KEY` returned a real
`HTTP 429 RESOURCE_EXHAUSTED` ("Quota exceeded ... limit: 20, model: gemini-3.7-flash"), while the
same key against the `cheap` tier returned `200 OK`. This is the same free-tier 20-requests/day
limit already documented in the Sub-project 3 section above, now hit again days later — Google's
quota, not an Aqd defect. The real defect: `analyzeContract` (`analyze-actions.ts`) collapsed every
non-`ai_disabled` task failure into a single generic `'unknown'` code, which the UI rendered as
"Something went wrong during analysis. Please try again." — indistinguishable from an actual bug,
even though the real classification (429) was already being logged server-side
(`console.error('[analyzeContract] task "X" failed:', ...)`, never swallowed). Fixed by carrying
the real HTTP status through `AiUpstreamError` (`router.ts`) into a new `quota_exceeded` UI error
code (`classify-error.ts`). **Verified live, full path, both failure and success:** uploaded the
real fixture through the running app, clicked Analyze — UI showed the new, specific
"The AI provider's daily quota is exhausted for this model..." message; `analyses.error` persisted
as `'quota_exceeded'` in the DB; server console showed the real `Gemini 429: {...}` body for all
four tasks, not swallowed. Then, with `AI_MODEL_MAIN` overridden to the `cheap` model as a
**process-only** env var (never written to `.env.local` — confirmed zero residue afterward) and the
dev server restarted, re-analyzed the same contract: `analyses.status` reached `'ready'`, summary/
fields/obligations all populated with accurate real data citing correct clause numbers, and
`usage_events` logged the actually-resolved model (`gemini-3.5-flash-lite`) per task. ⚪ The `risks`
task completed successfully but returned zero findings for this specific fixture on the cheap tier
(5 output tokens, i.e. an empty array) — plausible for a contract with no deliberately-planted
risks, not investigated further as it wasn't the reported defect; flagged here rather than silently
assumed fine.

🟢 **PDF header/footer contamination — fixed, general fix, not fixture-specific.** unpdf's merged
text extraction (`mergePages: true`) has no page-boundary markers, so this PDF's running header/
footer ("Aqd AI synthetic QA contract - testing only Page N") got interleaved into whichever clause
was open at each page break — confirmed via the real production `parseDocument`, not inspection:
Clause 8 ended "...until service is restored.\nAqd AI synthetic QA contract - testing only Page
2\nFor Severity 2 incidents...". Fixed in `parse.ts` by extracting per-page (`mergePages: false`)
and stripping lines that repeat, modulo a page number, across nearly every page — detected
structurally (near the top/bottom of a page, present on `pages.length - 1`+ pages) rather than by
matching this fixture's specific text, so the fix holds for any document's own header/footer, not
just this one. Verified the fix doesn't over-strip: the closing disclaimer ("Synthetic QA document
- for testing Aqd AI only...", appearing once, only on the last page) survives correctly. Live-
verified in the running app: all 28 clauses render with zero footer contamination.

⚪ **Arabic Clause 27 body — confirmed as a source-PDF defect, not an Aqd parsing bug, and left
unfixed because it cannot be fixed at the parsing layer.** Direct inspection of pdf.js's own
per-page `getTextContent()` (not just unpdf's wrapper) shows **zero text items** for the entire
Arabic sentence — it occupies real visual space in the rendered page but was never encoded as
selectable text in the PDF's content stream (consistent with some PDF generators rendering
complex-script runs as vector outlines rather than embedding them as real text when they can't
guarantee correct shaping/embedding). unpdf/pdf.js already auto-resolves `cMapUrl`/
`standardFontDataUrl` by default, ruling out a missing-CMap misconfiguration. No text-layer
extraction library — unpdf, pdf.js, or any other — can recover text that was never encoded as text.
Clause 27 still segments correctly (heading + English caption), just without the unrecoverable
Arabic body. Regression-tested as current, correct, asserted behavior (not a gap expected to close)
so a future library upgrade that changes this is visible via a failing test, not silently absorbed.

🟢 **OTP/email verification — confirmed working end to end; the reported "not receiving email" is
expected local-dev behavior, not a bug.** `RESEND_API_KEY` is unset in `.env.local` (no email
provider configured), so `sendCodeEmail` correctly takes its documented dev-mode fallback: no real
email is sent, and the code is shown directly on the verify screen ("Dev — no email is sent
locally. Your code is ..."), exactly as `src/lib/auth/dev-code.ts` was built to do. Live-verified
the complete path with a fresh signup: code generated → `issue_code` stored it → dev fallback
displayed it on-screen → entered it → `verify_code` accepted it → `email_confirmed_at` set →
redirected to onboarding. No code change needed; this is the intended behavior without a
configured email provider, matching the existing "AI disabled" / "no key configured" pattern
elsewhere in this codebase. Real-email delivery via a configured `RESEND_API_KEY` remains untested
(no Resend key available in this environment) — tracked as an open item, same shape as the
untested `main`/`heavy` AI tiers.

**Regression tests added:**
- `tests/ai/classify-error.test.ts` — `mapTaskError` correctly classifies a real 429
  (`upstreamStatus: 429`), a missing key (`disabled: true`), and a non-retryable non-quota error
  (neither); `classifyAnalysisError` prioritizes `ai_disabled` > `quota_exceeded` > `unknown`
- `tests/ingest/advanced-contract-test.test.ts` — the real fixture segments into all 28 clauses
  with zero header/footer contamination; the one-off closing disclaimer survives; Clause 27 still
  exists with its (unrecoverable) Arabic body documented as expected, not silently regressed

---

## Follow-up pass: chat "Something went wrong" on every question, Parties extraction blank, Resend blocker confirmed, grounding re-audited

Instructed to stop new feature work and fix these before continuing. Root-caused each before
touching code, with hard evidence at every step.

🟢 **Chat: same root cause as the analysis pipeline (main-tier 429), but worse -- completely
unlogged, not just genericized.** Live reproduction: multiple real `/api/chat` requests each took
~8.5-9.7s (the exact `fetchStreamWithRetry` backoff shape for a persistent 429: 1+2+4s + overhead),
and the dev server log contained **zero** occurrences of "429" or "RESOURCE_EXHAUSTED" anywhere --
unlike `analyze-actions.ts`'s `runTask`, `route.ts`'s catch block never called `console.error` at
all. The UI showed "حدث خطأ أثناء الإجابة. حاول مرة أخرى." (`chat.errors.upstream_failed`, the
same generic message for every non-`ai_disabled` failure). Fixed by adding the missing
`console.error` and classifying `AiUpstreamError.status === 429` as a new `quota_exceeded` chat
error code, mirroring the analysis-pipeline fix exactly. **Verified live, full success path, on a
freshly uploaded copy of the same fixture contract** with `main` tier pointed at the working
`cheap` model via a process-only env var (never written to `.env.local`): a grounded liability
question returned a correct answer citing Clause 18, with the citation verified in the database to
point at the real Clause 18 row; a late-payment-penalty question (the contract states a due date
but no penalty) correctly returned the Arabic `NOT_FOUND` message; and an Arabic governing-law
question against the English-only Clause 23 returned a clean, correctly-grounded Arabic answer
("تخضع هذه الاتفاقية لقوانين دولة الكويت [1]") with no Unicode corruption and no unnecessary
language switching -- covering the normal-answer, NOT_FOUND, citation-correctness, and
cross-language requirements together in one live pass.

🟢 **Parties extraction was blank -- real bug in segmentation, not the AI prompt, now fixed.**
The Provider/Customer names sit in a table before "Clause 1 - Definitions" in the source PDF.
`segmentClauses`'s `splitByHeadings` had nowhere to put lines seen before the first heading match
(`current` is `null` until the first heading, and the `else if (current)` branch silently drops
anything before that) -- confirmed directly: the segmented Clause 1 body started exactly at
"Definitions", with the entire title/description/party-table/dates preamble gone before it ever
reached `fieldsPrompt`. Fixed in `segment.ts` by capturing pre-heading lines as a leading,
unnumbered clause -- but only when a real heading is found later in the document, since a
genuinely headingless document must still fall through to `segmentClauses`' own paragraph-splitting
fallback (an early version of this fix broke exactly that case; caught by the existing
`segment.test.ts` suite before it shipped). **Verified live:** re-uploaded the same fixture as a
fresh contract, the reader now shows an unnumbered "Clause 1" preamble containing both company
names before the real numbered clauses begin; re-analyzing produced "Atlas Meridian Technologies
Ltd., Gulf Horizon Distribution W.L.L." in the Parties field (previously "—"), and the summary
itself now names both parties by name instead of generic phrasing.

⚪ **Email OTP: confirmed as an external blocker, not a code bug -- and there are two blockers,
not one.** `RESEND_API_KEY` is unset in `.env.local`, so no real email provider is configured; this
is why no real email is ever sent, exactly the documented dev-mode fallback (on-screen code)
behavior, already live-verified end to end in the prior pass. Went further this time per explicit
instruction that the dev hint doesn't count as verification: read `resend@6.24.0`'s own type
definitions and confirmed `email.ts`'s `resend.emails.send({from, to, subject, html})` call exactly
matches the real SDK's `CreateEmailOptions` shape -- the code itself is correct and would work with
a real key. Verified with a test that mocks the `resend` package's constructor (not a real network
call): the payload sent matches exactly, and a rejected send degrades to `false` rather than
throwing. **A second, independent blocker found:** `EMAIL_FROM="Aqd <auth@example.com>"` uses
`example.com`, a reserved documentation domain that can never pass Resend's required DNS
verification -- real delivery would still fail on an unverified-domain error even after adding a
real API key, until `EMAIL_FROM` points at an actual verified sending domain.

⚪ **Google login: unchanged from the prior pass, re-confirmed still accurate.** No real Google
Cloud OAuth client is available in this environment (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/
`_SECRET` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` all blank in `.env.local`) -- external blocker, not a
code defect. The button correctly detects this and shows "Google sign-in isn't configured yet."
without ever leaving the app, exactly as fixed and live-verified in the OAuth work earlier in this
session; `tests/auth/google-button.test.tsx` still passes.

🟢 **Grounding/isolation: re-audited exhaustively across every chat ever recorded in this
database, not just spot-checked.** Three direct SQL queries against the full `citations`/
`chat_messages`/`chats`/`clauses`/`contracts` join graph: zero citations point to a clause outside
their own chat's contract; zero citations have an `org_id` disagreeing with their clause's
`org_id`; zero chats have an `org_id` disagreeing with their own contract's `org_id`. Consistent
with the dedicated isolation investigation from the prior session (`tests/chat/
grounding-isolation.test.ts`) -- no leak found, this time checked database-wide rather than against
one pair of fixtures.

**Regression tests added:**
- `tests/chat/api-error-classification.test.ts` — the chat route logs the real upstream error and
  classifies a 429 as `quota_exceeded`, a non-429 upstream error as `upstream_failed`, and a
  missing key as `ai_disabled`
- `tests/auth/email.test.ts` — `sendCodeEmail` calls the real Resend SDK shape correctly when a
  key is configured, degrades to `false` (not a throw) on a rejected send, and never calls Resend
  at all when unconfigured (the exact condition this environment is actually in)
- `tests/ingest/segment.test.ts` (existing suite, caught a real regression in this pass) plus a new
  case in `tests/ingest/advanced-contract-test.test.ts` — the preamble clause captures both party
  names and the numbered clauses still start correctly at 1

---

## Sub-project 5 completion: product helper, chat history, e2e snapshots

🟢 **Product helper assistant, live-verified against its own exit test.** `askProductHelper`
deliberately queries no contract/clause/analysis/team table at all -- unlike the citation-locked
contract chat, there is no real data in its context to leak even in principle. Three live cases
covering the full exit test ("answers product questions and cannot answer data questions"): a real
product question got a correct, specific answer citing the actual Settings > Team flow; a question
naming a real uploaded contract by name got "I do not have access to your contracts or any of your
account data..." with a redirect to that contract's own chat, and no fabricated detail; an
off-topic general-knowledge question was correctly declined as out of scope.

🟢 **Chat history not reloading on refresh -- a real gap left open in the Sub-project 4 QA passes,
now closed.** The messages and citations were always fully intact in the database; `ChatPanel`
just had no fetch-on-mount. Fixed by having the contract page fetch history server-side (via a new
pure `buildChatHistory` helper, directly unit-tested) and pass it in. Live-verified on a contract
with real prior history spanning a cited answer, a `NOT_FOUND` refusal, and an Arabic answer --
all three render correctly after a full page reload, including the citation still pointing at the
correct clause.

⚪ **Running the e2e suite (`npm run e2e`, Playwright) for the first time this session surfaced 8
visual-regression failures** -- `/login` and `/signup` snapshots were stale relative to the Google
button + divider added earlier in this session's OAuth work (a ~4% pixel diff on each, exactly
consistent with one added UI element). Not a bug: regenerated the golden snapshots
(`--update-snapshots`) after confirming the current UI is correct (already live-verified separately
during the OAuth work). Full suite is green: 24/24 e2e (auth flows, accessibility, visual), 205/212
Vitest (the 3 failures are the same tracked quota-gated tests, plus 4 that `describe.skipIf` when
no key is present), `tsc --noEmit` clean, `next build` clean.

**Regression tests added:**
- `tests/ai/product-helper-prompt.test.ts` — the prompt instructs refusing/redirecting data
  questions, never fabricating, and actually describes real Aqd features
- `tests/app/help-actions.test.ts` — `askProductHelper` calls the `cheap` tier correctly, classifies
  429/disabled errors the same way as analysis and chat, and short-circuits a blank question
- `tests/chat/build-history.test.ts` — a `not_found` row renders the translated refusal text (not
  the literal persisted `"NOT_FOUND"` sentinel), citations attach to the right message with clause
  numbers resolved, an unanswered (failed) question shows with no citations rather than throwing,
  and an orphaned citation resolves to a null clause number rather than crashing

---

## Final hardening pass: the 4 tracked P1s, a security/RLS re-audit, logging gaps, performance, cleanup

Instructed to stop feature work and harden for release, with Resend/Google OAuth explicitly left
tracked rather than configured. Fixed all four P1s from the prior release memo, re-audited security
end to end, closed three more silent-failure gaps of the same shape already fixed elsewhere, took one
safe performance win, and cleaned up a large amount of accumulated local test data.

🟢 **P1: partial analysis failure now visible.** If some (not all) of the four analysis tasks fail,
`analyzeContract` previously still saved `status: 'ready'` with zero signal that anything was
missing. Now persists `error: 'partial'` on an otherwise-ready analysis, and the contract page shows
a small non-blocking notice. Regression test (`tests/app/analyze-partial-failure.test.ts`) drives
the real `analyzeContract` function against a mocked Supabase client and asserts the persisted
payload for both the one-task-fails and all-succeed cases.

🟢 **P1: `login_failed` events are now recorded.** Deferred since Sub-project 1 because a failed
login has no session, so `events_own_insert`'s `user_id = auth.uid()` RLS check can't pass for a
direct insert. Added `log_login_failed(p_email)`, a security-definer function (migration `0014`)
that looks the user up internally and writes nothing (no exception, no observable difference) when
the email matches no account -- callable by `anon`, the one place in this app that grant is
actually correct, since a failed login is inherently pre-authentication. **Live-verified end to
end**, including working around a real click-registration quirk in the browser-automation tooling
(a `computer`-tool click wasn't reaching React's event handler on this specific page load; a
JS-dispatched `.click()` on the same button worked immediately and correctly) -- confirmed via the
security activity feed showing "Sign-in attempt failed" twice, in both English and Arabic.

🟢 **P1: Next.js `middleware.ts` migrated to `proxy.ts`.** Pure rename per Next 16's own migration
guide (function `middleware` → `proxy`, same `config`/`matcher`, no behavior change) -- confirmed
against `node_modules/next/dist/docs` directly, per this project's own `AGENTS.md` instruction to
check the vendored docs before touching anything Next.js-specific. The deprecation warning is gone
from both `next dev` and `next build`. Caught and fixed the one test that hardcoded the old
filename (`tests/supabase-clients.test.ts`'s `CLIENT_EXCEPTIONS` list).

🟢 **P1: accumulated local test data cleaned up.** 55 `%@test.local` accounts and 579 of 581
organizations (most already orphaned by earlier, incomplete test cleanup across many prior
sessions) removed via cascade deletes. Verified safe first: listed every non-`.test.local` account
and confirmed the two real accounts (the user's own) and their orgs were untouched before deleting
anything, and re-verified after that both real accounts and their org memberships were fully intact.

🟢 **Security/RLS re-audit, this time systematic rather than spot-checked.** Every `public` table
confirmed to have RLS enabled (`pg_class.relrowsecurity`); every table's actual policies enumerated
via `pg_policies`. The two tables with zero policies (`login_codes`, `rate_limits`) are exactly the
two already documented as deliberately deny-all-except-definer-function. Every org-scoped table's
policy uses the identical `org_id = jwt_org_id()` expression for both `USING` and `WITH CHECK` --
no table found with a looser or inconsistent check. Re-confirmed `custom_access_token_hook` and the
`jwt_org_id()`/`jwt_org_role()` fallback compute the identical "first org joined" query, so there's
no discrepancy between what a real JWT carries and what the fallback would independently derive --
the fallback exists only for tokens minted before any org exists, not a live security gap.

🟢 **Three more silent-failure gaps, same shape as the ones already fixed this build, now fixed.**
`sendCodeEmail`/`sendInviteEmail` (`email.ts`) and `createUploadTarget`'s `parseDocument` call
(`contracts/actions.ts`) all swallowed their real error entirely on failure -- not just genericized
like the earlier analysis/chat bugs, fully discarded, no log anywhere. Matters more now given the
`EMAIL_FROM`/`example.com` finding: without this fix, a real Resend key with a still-wrong
`EMAIL_FROM` would fail every send with zero trace of why. `askProductHelper`'s catch classified the
error but didn't log it either, inconsistent with the discipline applied to analysis and chat --
fixed the same way, plus a `console.error` assertion added to its existing test.

🟢 **One safe performance win: parallelized the contract page's independent DB reads.** `contracts`,
`contract_versions`, `analyses`, and `chats` each key only on the route's own `contractId`, not on
each other's results, but were fetched as four-plus sequential round trips. Batched via
`Promise.all` (same queries, same RLS, just not waiting on each other), followed by a second
parallel batch for their dependents (`clauses`, `risk_findings`, `chat_messages`). Live-verified the
page still renders identically, including full chat history. No other redundant AI calls or N+1
query patterns found on review -- ingestion already batches all clause embeddings into one call,
analysis already dedupes by content hash, and chat's per-question embedding call is not cacheable
input by nature.

⚪ **Vitest config warnings cleaned up as a side effect of the file-convention work.** Renamed
`vitest.config.ts` → `vitest.config.mts` (resolves Vite's native-ESM-loader warning without adding
`"type": "module"` to the root `package.json`, which would have had much wider, riskier reach) and
switched `__dirname` to `import.meta.dirname` (required once the file is true ESM). Both warnings
were present in every single test run this session; neither reappears now.

⚪ **Dead-code scan: manual, not tool-assisted (no `ts-prune`/`knip` installed).** Zero `TODO`/
`FIXME`/`console.log` found anywhere in `src`. Spot-checked a sample of exports (e.g. `DevCodeHint`)
for actual usage -- all live. Not exhaustive; a proper unused-export tool would be worth adding if
this becomes a recurring concern.

**Regression tests added:** `tests/app/analyze-partial-failure.test.ts`, `tests/db/
login-failed.test.ts` (3 cases against the real function: real email, unknown email, empty/null
email), plus assertions added to three existing files (`tests/auth/login.test.ts`, `tests/auth/
email.test.ts`, `tests/app/help-actions.test.ts`) for the three logging fixes.

**Final suite: 215/218 Vitest** (only the same three tracked, independently-reproduced-again
quota-gated tests fail), **24/24 Playwright e2e** (one run showed 3 failures from resource
contention with a concurrently-running Vitest suite; re-run in isolation, all 24 passed), `tsc
--noEmit` clean, `next build` clean with zero warnings of any kind.
