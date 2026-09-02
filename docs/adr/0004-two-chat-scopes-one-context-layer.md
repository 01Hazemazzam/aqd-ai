# ADR-0004: Two chat scopes over one grounded context layer

Date: 2026-09-02
Status: Accepted

## Context

Contract chat answered questions about one document by embedding the question,
retrieving the top six clauses, and prompting over them. That shape had three
limits that showed up together once the Intelligence layer existed:

1. **Multi-clause reasoning was capped at six chunks.** A question spanning
   liability, termination and renewal could only be answered if all three
   happened to be retrieved.
2. **`NOT_FOUND` was ambiguous.** It could mean "the document does not say" or
   "retrieval missed it" — different statements to make to a lawyer, rendered
   identically.
3. **Portfolio questions had nowhere to live.** `chats` was `unique
   (contract_id) not null`, so "which contracts need attention?" could not be
   asked at all, despite the Intelligence layer computing exactly that.

Measurements that shaped the decision, taken against the live corpus:

- The largest contract is 31 clauses / 10.4 KB (~3K tokens).
- The entire portfolio — every finding, obligation and milestone — is ~12K
  tokens, about 1% of the main model's context window.
- 5 of 12 risk findings (42%) have **no clause**: the finding is that the
  document lacks the clause.
- Every one of 156 obligations is clause-anchored.

## Decision

**Two scopes, not one.** Contract chat keeps its guarantee that every fact
traces to a clause of *that* document. A second scope, the portfolio
Intelligence assistant, is grounded in aggregation output. `chats.contract_id`
becomes nullable, with partial unique indexes for each scope.

**Context assembly, not retrieval, when the document fits.** A deterministic
character budget (`CHAT_CLAUSE_BUDGET_CHARS`, default 60,000) decides. Under
it, the whole document goes to the model and `NOT_FOUND` becomes a truthful
claim. Over it, retrieval runs as before.

**Condense runs only on the retrieval path.** Its output has only ever fed the
embedding call, so on the full-context path it was a race the user waited
behind for nothing.

**One new citation target, not a polymorphic one.** `citations` gains a
nullable `finding_id` beside `clause_id`, with a check that exactly one is
set. Obligations and milestones cite through their clause; a finding about an
*absent* clause is the only evidence-bearing record with nothing to cite
through — and it is 42% of them.

**Three registers, marked in the context itself.** STATED (what the contract
says), EXTRACTED (findings and obligations, each already verified against a
clause), COMPUTED (dates our arithmetic produced, written in no contract). A
COMPUTED value may only be stated alongside its derivation, in the same
sentence.

**One assembly layer, one aggregation.** Both scopes read through
`loadIntelligence`, the same function the Intelligence views use.

## Consequences

The assistant and the Attention view cannot disagree about which contracts
need attention — they are the same object. Multi-clause reasoning works: a
live run answered "who has to do what, and by when?" with 19 obligations
spanning the whole document, including an Arabic clause, all 19 cited.

Retrieval is now rarely exercised in production, which is a liability: the
budget is injectable specifically so tests can force the fallback, and they
do. A retrieval path that never runs in CI is one that has already rotted by
the time the first oversized contract arrives.

The assistant can now state that a contract is *missing* a clause, which
clause-only citation made impossible.

Two costs accepted deliberately. Contract chat now sends more tokens per
question than top-6 retrieval did; at 3K tokens for the largest document in
the corpus this is not close to a constraint, and it buys a guarantee that
retrieval could not. And portfolio scope loads the whole org's intelligence
for every question, which is one aggregation over 12 contracts today — the
`narrow` parameter on `assemblePortfolioContext` is the seam where retrieval
goes when that stops being cheap.

## What live verification changed

Every rule below was added because a live run produced the failure, not
because it seemed prudent. They are listed because the pattern is the point:
each is a case where the model wrote something that *looked* correct.

- **`[contract=<uuid>]` in user-facing prose.** The internal marker was echoed
  verbatim — the same failure `renderClausesPlain` already documents for
  clause ids. Fixed by not rendering an identifier the model has nowhere to
  put, rather than by a rule telling it not to.
- **Zero citations on a three-contract answer.** Findings sat in one distant
  block and obligations in another, with nothing tying either to the contract
  the claim was about. Fixed by rendering each contract's evidence underneath
  that contract.
- **`[30, 31]` silently dropped.** The citation extractor matched only a lone
  number, so a grouped citation resolved to nothing while the answer still
  looked cited. This is the worst shape a grounding bug can take: invisible
  from the outside.
- **`[37، 38]` silently dropped.** The same bug in Arabic — U+060C is correct
  Arabic list punctuation, and matching only the Latin comma dropped every
  grouped citation in half the product.
- **`due_soon` and `[upcoming]` in prose.** Enum names leaking into
  user-facing text; square brackets already mean "citation" to every reader
  here. Both are rendered as words now.
- **An Arabic question answered in English.** Every structural label and most
  titles in the context are English, and the model followed the data's
  language rather than the question's. The rule now says the question's
  language outranks the data's, explicitly.
- **A bare `NOT_FOUND` for "what are the risks in this contract?"** on a
  contract with no stored analysis. True, useless, and easily read as "no
  risks". The absence of analysis is now stated in the context so it can be
  reported as what it is.

## Alternatives rejected

**Tool-calling.** Giving the model `searchClauses` / `listObligations` /
`getAttention` and letting it loop is the architecture that sounds right and
measurably loses here: every hop is latency on an already-flagged concern,
and a model that decides *not* to call `listObligations` produces a confident,
uncited, wrong answer with no verifier in the path. Deterministic assembly
puts that decision in code.

**A polymorphic citation target** (clause | finding | obligation | milestone).
Multiplies the invariant by four for no gain: an obligation's citation and its
clause's citation land in the same place.

**Merging the scopes.** One prompt carrying both rule sets is a prompt whose
guarantees nobody can state in a sentence, and it opens the exact path the
cross-contract isolation tests exist to close.

## Known gap

Lifecycle dates — a contract's effective date and initial term end — are the
only facts the assistant states without a citation. They come from the fields
extraction, which, unlike findings and obligations, never records *which
clause* it read them from. They are covered by the COMPUTED rule instead, so
they always travel with their derivation, but that is a weaker guarantee than
the rest of the layer offers. Closing it means recording source clause ids in
the fields extraction, which is a schema-version bump and a re-analysis.
