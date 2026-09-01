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

### Obligations

**Obligation**:
A who-must-do-what-by-when commitment extracted from a Contract's clauses — an obligor, an action, and a `due` written in the document's own words. The extractor never computes a date: `due` is a concrete date, a trigger, a recurrence, or absent, exactly as the document states it.
_Avoid_: task, todo, deadline (a deadline is only one shape of a `due`).

**Obligations register**:
The cross-contract consolidation of every Obligation from each Contract's latest Analysis, split into a **dated** timeline (Obligations whose `due` parses to a concrete calendar date, sorted and bucketed by urgency) and a **conditional** list (trigger-based, recurring, or undated Obligations, plus dates too ambiguous to place). Built by `buildObligationRegister`; see [ADR-0002](docs/adr/0002-obligations-date-policy.md).

**Urgency**:
The bucket a dated Obligation falls in relative to today — overdue, due soon (within 30 days), or upcoming. A property of the register's placement, not of the Obligation itself.

### Chat

**Contract chat**:
The citation-locked conversation grounded in one Contract's clauses. Every factual answer cites the Clause it came from by ordinal, or returns NOT_FOUND rather than inventing a fact. Streams its answer token by token.
_Avoid_: the chatbot, contract bot.

**Product helper**:
The assistant grounded only in a curated product-docs corpus, with zero data tools — structurally unable to reach user rows or secrets. Answers questions about using Aqd itself, not about any Contract. Returns one atomic answer.
_Avoid_: help bot, support bot.

**Chat widget**:
The shared presentational module both Contract chat and the Product helper render through: the message list, typing indicator, scroll behavior, bubble styling, and input form. Owns presentation only — each surface supplies its own transport and, where needed, its own message-content rendering.

**Citation**:
The link from a sentence in a Contract chat answer to the Clause that grounds it, written inline as an ordinal `[n]` and resolved to a real Clause. Clicking one scrolls to and flashes that Clause in the reader.
