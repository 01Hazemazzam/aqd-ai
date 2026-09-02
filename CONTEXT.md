# Aqd

Aqd (عقد) is a bilingual Arabic/English SaaS that analyzes commercial contracts: it ingests a document, segments it into clauses, scores risk against a playbook, extracts key fields, and answers grounded questions about the contract.

## Language

### Documents & analysis

**Clause**:
A single numbered provision of a Contract, segmented from the uploaded document. The unit that risk findings, obligations, and citations point at.

**Analysis**:
The cached result of running the four AI tasks (summary, fields, risks, obligations) over a Contract's clauses. Keyed by content hash so an unchanged document is a cache hit, not a re-spend.

**Risk finding**:
One playbook rule's verdict against the Contract — a severity plus a bilingual reason, optionally anchored to a Clause (or to a Clause's absence).

### Risk

**Risk portfolio**:
The cross-contract consolidation of every Risk finding from each Contract's latest Analysis, ranked worst-first. Carries portfolio-level counts (findings, Contracts affected), a severity breakdown, and a per-Contract grouping. Built by `buildRiskPortfolio`. Only the latest Analysis per Contract contributes — a re-analysis supersedes its predecessor rather than adding to it.
_Avoid_: risk dashboard, risk report.

**Severity**:
A Risk finding's weight — high, medium, or low — assigned by the playbook rule that produced it. Orders every list in the Risk portfolio and colors the Clause gutter in the reader.

**Drill-down**:
The path from a Risk finding in the portfolio back to its evidence: to the exact Clause when the finding is anchored to one, and to the Contract when the finding is about a Clause the document is *missing*. Landing on a Clause scrolls to it and flashes it — the same landing a Citation gives.

### Obligations

**Obligation**:
A who-must-do-what-by-when commitment extracted from a Contract's clauses — an obligor, an action, and a `due` written in the document's own words. The extractor never computes a date: `due` is a concrete date, a trigger, a recurrence, or absent, exactly as the document states it.
_Avoid_: task, todo, deadline (a deadline is only one shape of a `due`).

**Obligations register**:
The cross-contract consolidation of every Obligation from each Contract's latest Analysis, split into a **dated** timeline (Obligations whose `due` parses to a concrete calendar date, sorted and bucketed by urgency) and a **conditional** list (trigger-based, recurring, or undated Obligations, plus dates too ambiguous to place). Built by `buildObligationRegister`; see [ADR-0002](docs/adr/0002-obligations-date-policy.md).

**Due specification**:
The structured reading of an Obligation's `due`: an Anchor, an offset and unit, and a direction (before/after/on), alongside the phrase exactly as the document writes it. Produced by the extractor and verified against the source Clause in code, never parsed out of the `due` string afterwards. See [ADR-0003](docs/adr/0003-deadline-resolution-from-stated-facts.md).
_Avoid_: date hint, parsed due.

**Anchor**:
The event a Due specification counts from — one of a closed set: `absolute_date`, `effective_date`, `term_end`, `contract_event`, `none`. Only the first three can ever become a date; `contract_event` (receipt, request, termination, confirmation) names an event the Contract never dates, so it stays unresolved permanently.

**Resolution**:
Turning a Due specification into a calendar date by arithmetic over facts the Contract states, or recording why it cannot be. Carries a **resolution status** — `resolved`, `unresolved`, or `no_deadline_stated` — and, when unresolved, a separate **reason** naming what stopped it (`anchor_not_dated`, `term_not_stated`, `effective_date_not_stated`, `unit_not_computable`, `incomplete_spec`). Status and reason are two axes because they answer different questions: "10 Business Days after the Effective Date" has a perfectly resolvable Anchor and an uncomputable unit, so a single status word would have to lie about one of them. When resolved it also carries a **derivation**: the arithmetic behind the date, in parts (anchor, anchor date, direction, offset, unit) rather than prose, so the sentence can be written in the reader's own language. Deliberately not a confidence score: a status says *what* is uncertain, a number does not.

**Party role**:
An Obligation's obligor mapped onto the Contract's own parties — `party_a`, `party_b`, `both`, or `third_party` — carried alongside the verbatim obligor text, which is what the UI displays. Positional rather than semantic (not "provider"/"customer") because Aqd ingests contract types whose parties are landlord/tenant or employer/employee. A mutual obligation genuinely has more than one responsible party.
_Avoid_: owner, assignee, responsible party (an Obligation is owed, not assigned).

**Urgency**:
The bucket a dated Obligation falls in relative to today — overdue, due soon (within 30 days), or upcoming. A property of the register's placement, not of the Obligation itself.

### Chat

**Contract chat**:
The citation-locked conversation grounded in one Contract — its clauses, and the Risk findings and Obligations its Analysis produced. Every factual answer cites the record it came from by ordinal, or returns NOT_FOUND rather than inventing a fact. Streams its answer token by token. One of the two scopes of the Intelligence assistant; the other is Portfolio chat.
_Avoid_: the chatbot, contract bot.

**Portfolio chat**:
The second scope of the Intelligence assistant: a conversation about the whole portfolio rather than one Contract, grounded in the Intelligence layer instead of in clause text. Answers "which Contracts need attention", "what is due when", "who owes what". A separate thread from Contract chat, because the two are grounded in different evidence and guarantee different things. See [ADR-0004](docs/adr/0004-two-chat-scopes-one-context-layer.md).
_Avoid_: global chat, portfolio bot.

**Grounded context**:
Everything a chat scope hands the model for one question: the assembled text plus the map from each ordinal back to the record it points at. Built by one function per scope so the numbering and the citation resolution cannot drift apart. Only records that can be cited are numbered — a claim with no Clause and no Risk finding behind it gets no ordinal, and so cannot be referenced as a fact.

**Register**:
Which kind of thing a statement in a grounded context is, marked in the context itself so an answer can keep them apart. Three: **stated** (what the Contract says), **extracted** (Risk findings and Obligations, each already verified against a Clause), and **computed** (dates Aqd's arithmetic produced from stated facts, written in no Contract). A computed value may only be stated alongside its Derivation.

**Context budget**:
The character count of Clause text above which Contract chat stops sending the whole document and falls back to retrieval. Characters rather than tokens because it must be deterministic and free to compute. Which side of it a question lands on changes what NOT_FOUND means: with the whole document in context the Contract genuinely does not say it; with excerpts, only that the excerpts do not.

**Coverage warning**:
The named list of in-scope Contracts whose Analysis predates deadline extraction, appended to any answer about timing. Named rather than counted, because "nothing is due next month" is a *false* answer — not merely an incomplete one — when the deadline data for two thirds of the portfolio was never extracted.

**Product helper**:
The assistant grounded only in a curated product-docs corpus, with zero data tools — structurally unable to reach user rows or secrets. Answers questions about using Aqd itself, not about any Contract. Returns one atomic answer.
_Avoid_: help bot, support bot.

**Analysis rail**:
The panel beside the document in the contract reader holding everything the Analysis produced — Risk findings, summary and key fields, Obligations — plus Contract chat, behind one tab strip. A Risk finding in the rail expands to quote its own Clause inline, and can jump the document to it. Sticky beside the document on wide screens; above it on narrow ones.
_Avoid_: sidebar, analysis panel.

**Chat widget**:
The shared presentational module both Contract chat and the Product helper render through: the message list, typing indicator, scroll behavior, bubble styling, and input form. Owns presentation only — each surface supplies its own transport and, where needed, its own message-content rendering.

**Citation**:
The link from a sentence in a Contract chat answer to the Clause that grounds it, written inline as an ordinal `[n]` and resolved to a real Clause. Clicking one scrolls to and flashes that Clause in the reader.

### Intelligence

**Contract intelligence**:
The operational layer over everything the Analyses produced — the Milestone calendar, the Obligations register, and the Risk portfolio read together rather than as separate pages. Answers "what needs attention", not "what does this contract say".
_Avoid_: analytics, dashboard, insights.

**Milestone**:
A dated point in a Contract's life that the document states or that arithmetic over stated facts yields: its effective date, its initial term end, and any resolved Obligation deadline. Every Milestone carries its Resolution, so none of them is unexplainable.

**Lifecycle calendar**:
The cross-contract agenda of Milestones, grouped by month. An agenda rather than a month grid: with dates arriving only from stated facts, the portfolio yields tens of Milestones, not hundreds.

**Attention item**:
A Clause that carries both a Risk finding and an Obligation — a duty someone must perform that the playbook or the cross-clause pass also flagged. The primitive of the Intelligence layer, and the reason an item is *actionable* rather than merely listed.

**Contract attention**:
The contract-level aggregation of Attention items and Milestones, ranked by explicit tiers (overdue with high-severity risk first, then due-soon with high severity, and so on). Tiers rather than a blended score, so the ordering can be explained.

**Analysis schema version**:
The version of the extraction contract an Analysis was produced under. Part of the Analysis cache key, so raising it makes each Contract re-analyse once on demand; an Analysis produced under an older version is **outdated** and says so, rather than silently lacking Due specifications.
