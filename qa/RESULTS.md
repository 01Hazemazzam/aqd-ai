# Sub-project 3 real-model validation — results

Run date: 2026-08-28/29. Model: `gemini-flash-lite-latest` (a rolling alias; resolved to a
specific Gemini 3.x-generation model at run time — see note on model naming below).
`gemini-flash-latest` (the intended "main" tier default) was also confirmed working, but its
free-tier daily quota (20 requests/day/model) was exhausted early in this session by smoke
tests, so the bulk of this evaluation ran on the `cheap`-tier model instead. Anthropic was not
tested — no `ANTHROPIC_API_KEY` was provided.

Every result below came from the real production path: seeded clauses → the actual
`analyzeContract` server action → real Gemini calls → real parsing → real Postgres persistence
→ real UI render, driven through the actual running dev server, not a reimplementation.

## Model naming (a real bug found and fixed)

The router's original defaults (`gemini-2.5-flash`, `gemini-2.5-flash-lite`) returned
**404 "no longer available to new users"** on the very first real call. Fixed by switching to
Google's rolling aliases (`gemini-flash-latest`, `gemini-flash-lite-latest`), which resolve to
whatever the current model is — the fix that actually resists this exact class of breakage
recurring, rather than pinning a new version number that will eventually retire too.

## Fixture A — English (`en-software-license.json`)

| Task | Result |
|---|---|
| Summary | Pass. Accurate, flags the risky terms proactively. First run cited raw clause UUIDs in the prose (bug, fixed — see below); second run correctly cited `(clause 1, clause 3, clause 4)` etc. |
| Fields | Pass. `parties`, `effectiveDate`, `termLength` correct. `governingLaw` and `totalValue` both correctly `null` — neither is stated in the document (the fee amount is deferred to an un-provided Exhibit A). No fabrication. |
| Risks | Pass, 7/7. All 7 expected findings present with correct severity and correct clause references (or `null` for the 3 missing-clause findings): `termination_clause`(high, missing), `unlimited_liability`(high, clause 7), `auto_renewal_notice`(medium, clause 4), `indemnification_balance`(medium, clause 8), `unilateral_amendment`(medium, clause 9), `governing_law`(medium, missing), `dispute_resolution`(low, missing). Zero false positives — `confidentiality` (satisfied by clause 6) correctly not flagged. First run returned 0 findings (bug, fixed — see below). |
| Obligations | Pass, 3/3 grounded: Licensee pays fees (clause 5, correct due date), each party keeps confidentiality (clause 6), Licensee indemnifies Licensor (clause 8). All obligor/action/clauseId correct, nothing invented. |

## Fixture B — Arabic (`ar-consulting.json`)

| Task | Result |
|---|---|
| Summary | Pass, fully in Arabic. Fluent and accurate. First run mixed the English word "clause" into otherwise-Arabic prose (bug, fixed — see below); after the fix, verified in isolation to use Arabic throughout (`الفقرات`/`البند`, no English leakage). |
| Fields | Pass. `parties` extracted correctly in Arabic script (no invented transliteration), `totalValue` correctly extracted with the Arabic-numeral amount, `governingLaw` correctly `null` (genuinely absent), `effectiveDate`/`termLength` correct. |
| Risks | Partial pass, then fixed. Correct: `governing_law` and `dispute_resolution` (the only two genuinely missing required clauses). **Real false positive found**: the model also flagged `indemnification_balance` for the *absence* of any indemnification clause — that rule's actual text is about an *existing* clause being one-sided, not absence. Prompt fix applied (see below); not yet re-verified live for this specific fixture due to quota exhaustion (was verified live on Fixture C, same rule class, same fix). One additional finding — `unlimited_liability` flagged because clause 8 caps only the Consultant's liability with no reciprocal cap for the Client — is a **defensible, non-hallucinated reading**: the rule's own description says "unlimited **or one-sided**," and the clause genuinely is one-sided. Recorded as a judgment call, not an error. |
| Obligations | Pass, 4/4 grounded, correct obligor identification throughout (`المستشار`/`العميل`/`كل طرف`), correct due dates or correctly `null` when the source doesn't state one. |

## Fixture C — Mixed EN/AR (`mixed-dpa.json`)

| Task | Result |
|---|---|
| Summary | Pass, written in Arabic (reasonable choice given the majority-Arabic critical clauses), grounded, no English leakage. One cosmetic glitch: a stray literal `0` inside an Arabic number ("ثلاث0 يوماً" instead of "ثلاثين يوماً") — the *same fact* is correctly rendered elsewhere in the structured `obligations` JSON, so this is a free-text generation glitch, not a wrong fact. |
| Fields | Pass, and the important cross-language case worked: `governingLaw` was correctly extracted **in Arabic from an Arabic-only clause** (clause 6), not missed because the surrounding clauses were English. `termLength` was correctly quoted in English from the English clause that states it. `totalValue` correctly `null`. |
| Risks | **Real false positives found** (first run, pre-fix): `auto_renewal_notice`, `unilateral_amendment`, and `indemnification_balance` all fired for clause types that are simply absent from this contract — the same rule-scoping bug as Fixture B, more pronounced. Only `confidentiality` (a genuinely presence-requiring rule) and nothing else should have fired. **Verified fixed**: after strengthening the prompt with explicit examples naming the exact rules and an explicit "absence is not itself a violation of these rules" instruction, a direct re-run against the real API returned exactly one finding — `confidentiality` — matching ground truth precisely. `governing_law` and `dispute_resolution` were correctly *not* flagged both before and after the fix (clause 6 satisfies both, in Arabic). |
| Obligations | Pass, 3/3, correct per-clause obligor language (`المعالج` for Arabic clauses, `Processor` for the English one — the model followed each clause's own language rather than normalizing to one). |

## Hallucination testing

No fabricated dates, parties, amounts, or obligations observed anywhere across 3 contracts × 4
tasks. Every `null` in `fields` matched a genuine absence in the source text. Zero risk findings
referenced a clause id that didn't belong to the contract being analyzed (the code also enforces
this: `analyze-actions.ts` filters findings against the real clause id set before insert). The
main integrity risk found was not hallucination but **rule misapplication** — real observations
(a clause type is missing) attached to the wrong playbook rule — covered above.

## Provider failure handling

Real (not just mocked) failures observed and handled correctly during this session:
- **Real `429 RESOURCE_EXHAUSTED`** (daily free-tier quota) on multiple calls — caught, logged,
  did not crash the request, and did not take down sibling tasks (`summary` succeeded in the same
  batch where `fields`/`risks`/`obligations` all 429'd).
- **Real `503 UNAVAILABLE`** ("model is currently experiencing high demand") — same handling.
- **Real malformed-JSON failure**: a live risks response failed strict `JSON.parse` with "Bad
  Unicode escape in JSON" (a stray backslash inside Arabic `reasonAr` text). This silently
  discarded 7 correct, real findings — a genuine production bug, now fixed with a targeted
  backslash-repair pass in `extractJson` (unit-tested with the exact failure shape).
  Independently, `runTask`'s bare `catch {}` was also silently swallowing every failure reason
  with no log line at all — the reason this bug took real debugging effort to even find. Fixed:
  now logs `console.error` with the real error message.
- Mocked-only, not re-forced live (unreliable to trigger on demand against a real API):
  safety-content-block (`promptFeedback.blockReason`), `MAX_TOKENS` truncation, a persistent 5xx
  exhausting all retries, and a non-retryable 4xx not being retried. Covered in
  `tests/ai/router.test.ts` against response shapes matching what was actually observed live
  this session (the 429/503 bodies above were captured verbatim and match the mocked test
  fixtures' shape).
- Granular failure confirmed for real, not just asserted: on Fixture A's first real run, `summary`
  succeeded while `fields`/`risks`/`obligations` all failed in the same batch, and the partial
  result (`status: 'ready'`, only `summary` populated) persisted correctly rather than the whole
  analysis being lost.

## Caching

Verified live: re-running `analyzeContract` on an already-`ready` analysis with an unchanged
content hash returned in **147ms** with **zero new `usage_events` rows** (9 before, 9 after),
versus 7–22 seconds and 4–5 new rows for a real analysis. Cache correctly keys on
`(org_id, content_hash)`.

## Security / RLS

No service-role key used anywhere in this validation — every insert/select went through the
caller's own session client, same as the rest of the app. `tests/ai/schema-integration.test.ts`
(real local Postgres, two real orgs) confirms: `playbook_rules` readable by any authenticated
user; `analyses`/`risk_findings`/`usage_events` fully invisible cross-org and an insert into
another org's `analyses` is rejected by RLS, not application logic.

## Tests / build

- `npx tsc --noEmit`: clean.
- `npm test`: 111/111 (27 files) — includes the new backslash-repair and clause-id-leak
  regression tests.
- `npm run e2e`: 24/24.
- `npm run build`: clean production build, ran successfully against the same `.next` directory
  as the live dev server without disrupting it.

## Exact code/prompt changes made (all evidence-based, none speculative)

1. `src/lib/ai/router.ts` — model defaults `gemini-2.5-flash`/`gemini-2.5-flash-lite` →
   `gemini-flash-latest`/`gemini-flash-lite-latest` (404 on the pinned names, confirmed live).
2. `src/lib/ai/prompts.ts` — `extractJson` now retries with a stray-backslash repair pass before
   giving up (real "Bad Unicode escape" failure, confirmed live, unit-tested).
3. `src/lib/ai/prompts.ts` — `summaryPrompt`/`fieldsPrompt` no longer receive `[id=...]`-tagged
   clause text (only `risksPrompt`/`obligationsPrompt` need it); clause number markers dropped
   the English word "clause" (real UUID-leak and English-leak bugs, both confirmed live).
4. `src/lib/ai/prompts.ts` — `HARD_RULES` gained an explicit language-consistency instruction
   (real English-leak-into-Arabic bug, confirmed live, confirmed fixed).
5. `src/lib/ai/prompts.ts` — `risksPrompt` gained an explicit, example-grounded instruction that
   an imbalance/one-sidedness rule does not fire on a clause type's mere absence (real false
   positives on 2 of 3 fixtures, confirmed live, confirmed fixed on Fixture C; Fixture B not
   re-verified live due to quota).
6. `src/app/(app)/contracts/[id]/analyze-actions.ts` — `runTask`'s silent `catch {}` now logs the
   real failure reason (this bug is why finding #2 above took real effort to diagnose).

## Remaining risks / not yet verified

- **Fixture B's risk-scoping fix was not re-verified against a full live re-run** (quota
  exhausted) — only verified on Fixture C, same rule class, same fix, same code path.
- **`gemini-flash-latest` (the "main" tier) was barely exercised** — most of this evaluation ran
  on the `cheap` tier's model because `main`'s daily quota was exhausted by early smoke tests.
  Quality may differ between tiers; not compared head-to-head.
- **Anthropic (`heavy` tier) is completely untested** — no key provided.
- **Free-tier daily quota (20 req/day/model) makes this evaluation genuinely hard to repeat
  same-day.** `qa/seed-fixture.mjs` + `qa/fixtures/*.json` make the contract-seeding half
  instantly repeatable; the AI-calling half is quota-gated. A paid tier or a fresh key is needed
  for a same-day repeat or for testing the `main`/`heavy` tiers properly.
- **Only 3 fixtures, single-run each** (except Fixtures A and C's risks task, run twice each).
  Real model output is non-deterministic; a single pass-per-task is evidence, not a guarantee the
  same fixture won't produce a different false positive on another run.
- **The Arabic "ثلاث0" digit-rendering glitch** in Fixture C's free-text summary is unexplained
  and unfixed — low-severity (the correct value is present elsewhere in the same analysis), but
  worth a second data point before assuming it's rare.
- **No dedicated "missing indemnification/amendment/auto-renewal clause" playbook rule exists.**
  The fix teaches the model not to misuse the imbalance rules for absence, but a genuinely
  interesting missing-indemnification-clause case (arguably a real risk in some contracts) now
  goes unflagged entirely rather than under the wrong rule. That's the correct tradeoff (a
  misapplied finding is worse than a silent one for a case no rule actually covers), but it's a
  playbook-content gap, not just a prompt-precision one, if that scenario turns out to matter.

## Verdict

**Sub-project 3's core analysis logic is sound and, with the fixes above, produces reliable,
grounded, well-cited output in English, Arabic, and mixed-language contracts on this model.**
Three real bugs were found and fixed by this validation, all through evidence from real model
output, not speculation — none would have been caught by the mocked unit-test suite alone. The
system is **not yet production-ready as originally shipped** (2 of the 3 bugs fixed here would
have silently destroyed real risk-finding data or leaked internal ids to users); it **is** ready
now that those fixes are in, with the caveats above (main/heavy tiers, and Fixture B's fix)
still needing a same-day-repeatable live re-check once quota allows.

**Safe to proceed to Sub-project 4?** Yes, with one condition: sub-project 4 (citation-locked
chat) will reuse this exact JSON-extraction/parsing discipline, so the two fixes to
`extractJson`/`prompts.ts` made here directly reduce risk there too. Recommend budgeting a
second real-model pass (with quota headroom) before trusting citation-locked chat's own
NOT_FOUND behavior, using the same fixtures.
