# ADR-0005: Revisions compared by text, not by model

Date: 2026-09-02
Status: Accepted

## Context

`contract_versions` was designed for revisions from the first migration — its
comment reads "a contract can be re-uploaded (a revised draft); each parse run
gets its own version" — and every consumer already selected the *latest*
version. But `version_no` was hardcoded to `1`, so a second upload of the same
contract had two possible outcomes and neither was the intended one: a new
contract with no relationship to the first, or, on the same contract, a unique
constraint violation surfaced to the user as "something went wrong".

Meanwhile the question a returned draft actually raises — *what did they
change?* — had no answer anywhere in the product. Reading two drafts side by
side is the work Aqd exists to remove.

## Decision

**Ingest numbers versions; nothing else changes.** `ingestContract` reads the
contract's highest `version_no` and adds one. Every downstream consumer
already read the latest version, so the whole reader, analysis and chat path
follows a revision without modification.

**The alignment is deterministic, not a model call.** Three passes over the
two clause lists, strongest evidence first: identical normalized text, then a
clause number that identifies exactly one unpaired clause on each side, then
Dice similarity over token sets above 0.45. Each pass consumes what it
matches, so identity is never outbid by similarity.

The tempting alternative — ask the model which clause of v2 corresponds to
clause 7 of v1 — loses on the failure mode, not on accuracy. A wrong pairing
does not look wrong: it renders as an amendment nobody made, or hides a
deletion behind an "edit". A deterministic pairing is reproducible, free,
instant, and checkable by eye.

**A pairing is refused rather than guessed.** Below the similarity floor, a
clause is reported as one removal and one addition. That is wrong in the
direction the reader can see and correct; the false pairing is not.

**Risk delta pairs on the playbook rule.** Titles are generated prose and get
re-worded between runs — in the live verification the same rule came back with
an English title in one version and an Arabic one in the next, and matched
anyway. Cross-clause findings (asymmetry, contradiction, dependency) have no
rule key and fall back to their title, which over-reports change rather than
concealing it.

**"No longer reported", never "resolved".** A finding that stops appearing is
an observation about the analysis, not a confirmation that the risk was
negotiated away. The type, the message key and the UI copy all say the
observed thing.

**A failed revision destroys nothing.** Parsing runs before any row is
written, so an unreadable file writes no version; and `contracts.status` is
only set to `failed` when the contract has no other version to lose.

**Bytes already on the contract are refused.** The comparison they would
produce is every clause unchanged.

## Consequences

The reader had to become version-aware in one place beyond the version label:
it renders the newest version's clauses, so it must show that version's
analysis or none at all. Before revisions existed, "latest analysis of the
contract" and "analysis of the version on screen" were the same row; they come
apart the moment a revision lands, and the stale reading would have attached
the previous draft's findings — including clause ids the document no longer
contains — to the new text.

Live verification against a two-draft MSA: 5 modified, 1 added, 1 removed, 6
unchanged, with both renumbered clauses (10→9, 11→10) correctly reported as
unchanged text under a new number rather than as amendments, and the redline
locating single-word changes inside otherwise identical paragraphs. The risk
delta caught the point of the exercise — removing the liability cap for
indemnity claims introduced a new high-severity finding.

The similarity floor is one number standing in for a judgement, and the corpus
that tuned it is small. It is a constant in one module with tests either side
of it, which is where it should live when the evidence to move it arrives.

## Alternatives rejected

**A model-driven alignment.** See above: confident, occasionally wrong, and
wrong invisibly.

**Character-level diff.** Legally meaningless noise — "thirty" to "forty-five"
renders as a scatter of letters. Words are the smallest unit a contract
argument turns on.

**Diffing whole documents rather than clause lists.** Throws away the clause
structure the entire product is built on, and with it the ability to say
*which provision* moved.

**Storing the comparison.** It is a pure function of two clause lists that
runs in microseconds. A stored copy is a cache that can disagree with the
documents.
