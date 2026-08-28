# Sub-project 3 — running quality findings log

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

Not regression-tested (impractical without live-model calls each run): the live model-quality
findings themselves (false-positive rate, extraction accuracy, Arabic fluency). These are the
kind of thing `qa/fixtures/*.json` + `qa/seed-fixture.mjs` exist for — re-run by hand against a
real key when the prompts or playbook change materially, not on every CI run.
