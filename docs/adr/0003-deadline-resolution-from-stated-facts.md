# Deadlines are resolved by arithmetic over stated facts, never by inference

[ADR-0002](0002-obligations-date-policy.md) established that `buildObligationRegister` must not resolve relative phrases into dates, and pointed at where the fix belongs if concrete dates are ever genuinely needed: "the correct place is the extraction prompt (emitting a normalized date the document actually implies)". This ADR takes that route. **0002's ban on parser heuristics stays in force** — nothing here loosens it.

The forcing evidence: across all 12 analysed contracts, **0 of 147 obligations** have a `due` that parses to a calendar date. Every non-null due is relative ("at least sixty (60) days before the end of the then-current term") or trigger-based ("within thirty (30) days after receipt"). The register's dated timeline is empty in production — not broken, just never populated. Any calendar, upcoming-actions view, or renewal-window alert built on `due` as it stands shows nothing.

## Decision

The extractor emits a **due specification** — the structure of the deadline, with each part quoted from the clause:

- `verbatim` — the phrase exactly as the document writes it
- `offset` + `unit` — e.g. 60, `day`
- `direction` — `before` | `after` | `on`
- `anchor` — one of a closed set: `absolute_date`, `effective_date`, `term_end`, `contract_event`, `none`

Resolution to a calendar date happens in code, and only when the anchor is itself a stated fact:

- `absolute_date` — the document names the date
- `effective_date` — from `fields.effectiveDate`
- `term_end` — `effectiveDate + termLength`, both explicitly stated

`contract_event` (receipt, request, termination, confirmation, notice) is **never** resolved: the contract states the interval but not when the event occurs, so no date exists to compute. 38 of 147 obligations are of this kind, and they stay unresolved permanently. That is correct, not a gap.

**Resolution stops at the initial term end.** These contracts auto-renew for successive periods, so "the then-current term" moves — but only if nobody gave notice and the renewal actually happened. Projecting through a renewal would put a legal deadline on the calendar that rests on two assumptions the document does not make. A contract past its initial term shows its renewal window as unresolved rather than as a date.

**No confidence score is stored.** A resolved date carries instead a `status` (`resolved` | `unresolved_anchor` | `no_deadline_stated`) derived in code, its verified clause quote, and its derivation — "initial term end 31 May 2028, minus 60 days, from clause 4". A model-reported number would be the one field on an evidence-grounded record that nothing verifies, and it cannot say *what* was uncertain; a status can.

Term length is parsed from `fields.termLength` ("eighteen (18) months", "24 months") by a pure function that accepts only unambiguous durations and returns null otherwise — the same posture 0002 takes toward slash-dates.

## Consequences

A resolved date is auditable end to end: quote → structure → arithmetic → date. Nothing on a timeline is unexplainable, which is the property that makes putting dates on a legal calendar defensible at all.

The yield is small and that is expected. Only 7 of 147 obligations anchor to the term, and only 6 of 12 contracts state both an effective date and a term length. The calendar's volume comes from contract lifecycle milestones (effective date, initial term end), with resolved obligation deadlines — mostly renewal-notice windows — as the high-value additions.

Analyses are cached by `content_hash` over a document that never changes, so an existing analysis would never gain due specifications. The cache key therefore includes an analysis schema version: raising it makes every contract re-analyse once, on demand, and an analysis produced by an older version is surfaced as outdated rather than silently missing deadlines.

Do not add an anchor kind without a resolution rule that traces to a stated fact, and do not resolve `contract_event` by assuming an event date — assuming "termination" means today, or the term end, would fabricate exactly the deadline 0002 exists to prevent.
