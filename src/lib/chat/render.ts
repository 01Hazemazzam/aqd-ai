// How a grounded source is written for the model, and what its number means.
//
// Both scopes render the same records -- a contract's facts, a risk finding,
// an obligation -- and both must render them IDENTICALLY. If the portfolio
// assistant and the contract assistant describe the same obligation
// differently, the model has been given two vocabularies for one thing, and
// the failure shows up as an answer that is subtly right in one scope and
// subtly wrong in the other. So the renderers live here and each scope only
// decides which records to pass.
//
// The three registers a grounded answer must keep apart, and how each is
// marked in the text below:
//
//   STATED    -- what a contract says. Rendered plainly, marked "(stated in
//                the contract)" where it could be mistaken for a derived
//                value.
//   EXTRACTED -- findings and obligations, each checked against its clause at
//                extraction time. These carry an ordinal and are citable.
//   COMPUTED  -- dates Aqd's own arithmetic produced from stated facts. These
//                appear in no contract, are always prefixed COMPUTED, and
//                always carry their derivation inline so the prompt can
//                require the two to travel together.

import { extractCitationOrdinals } from '@/lib/ai/prompts'
import type { Derivation, Resolution } from '@/lib/intelligence/due-spec'
import type { AttentionItem, AttentionTier, TrackedObligation } from '@/lib/intelligence/build'
import type { LoadedFinding } from '@/lib/intelligence/load'

/** What a citation ordinal resolves to. Exactly one target, mirroring the
    `citations_exactly_one_target` check added in migration 0019. */
export type SourceTarget = { kind: 'clause'; clauseId: string } | { kind: 'finding'; findingId: string }

export interface Source {
  /** 1-based. This is the number the model writes as [n]. */
  ordinal: number
  contractId: string
  target: SourceTarget
}

export interface ContractFacts {
  /** Not rendered into the prompt. See renderContractFacts. */
  contractId: string
  title: string
  parties: string[]
  /** ISO, as parsed from the date the contract states. */
  effectiveDate: string | null
  /** The term as the document words it, e.g. "twenty-one (21) months". */
  termLength: string | null
  /** COMPUTED: effective date plus the stated term, minus a day. */
  termEnd: { date: string; derivation: Derivation | null; termLength: string | null } | null
  /** False when this contract's analysis predates deadline extraction, so its
      obligations contributed no dates at all. */
  current: boolean
  /** Portfolio scope adds the attention tier here; contract scope leaves it
      empty. Extra lines rather than a second renderer, so the shared parts
      cannot drift. */
  extraLines?: string[]
}

export function renderDerivation(d: Derivation | null, termLength: string | null): string {
  if (!d) return ''
  const anchor =
    d.anchor === 'term_end' ? 'initial term end' : d.anchor === 'effective_date' ? 'effective date' : 'the date stated in the contract'
  const head = `${anchor} ${d.anchorDate}`
  if (termLength) return ` (${head} plus ${termLength})`
  if (d.verbatim) return ` (${head}, ${d.verbatim})`
  if (d.offset === null || d.unit === null || d.direction === null) return ` (${head})`
  // An hours or business-day interval has already been collapsed to a day by
  // resolveDue; naming the unit it was collapsed FROM would overstate what
  // the date represents.
  const unit = d.unit === 'hour' || d.unit === 'business_day' ? 'day' : d.unit
  return ` (${head}, ${d.direction === 'before' ? 'minus' : 'plus'} ${d.offset} ${unit}s)`
}

const UNRESOLVED_REASON: Record<string, string> = {
  anchor_not_dated: 'counts from an event the contract never dates, so no calendar date exists',
  term_not_stated: 'the contract does not state both an effective date and a term length',
  effective_date_not_stated: 'the contract states no effective date',
  unit_not_computable: 'measured in business days, and the contract never lists the holidays',
  incomplete_spec: 'the stated timing is missing a part needed to compute a date',
}

export function renderResolution(r: Resolution): string {
  if (r.status === 'no_deadline_stated') return 'no timing stated in the contract'
  if (r.status === 'resolved' && r.date) return `COMPUTED ${r.date}${renderDerivation(r.derivation, null)}`
  return `no date derivable -- ${r.reason ? UNRESOLVED_REASON[r.reason] : 'the contract does not support one'}`
}

// Nothing in this block is numbered, because none of it has a record to point
// at: effectiveDate and termLength come from the fields extraction, which --
// unlike findings and obligations -- never recorded which clause it read them
// from. That is a gap in the extraction schema, not a decision made here.
// Until it is closed, a lifecycle date is stateable only under the COMPUTED
// rule, with its derivation attached, and the prompt says exactly that.
// The contract's UUID is deliberately NOT rendered. An earlier version wrote
// `[contract=<uuid>]` here and a live run put the raw UUID straight into the
// user-facing answer -- the same failure renderClausesPlain already documents
// for clause ids. The fix is not a "don't mention the id" rule: it is not
// handing the model an identifier it has nowhere to put. Nothing resolves a
// contract id in an answer, so nothing needs to see one.
export function renderContractFacts(f: ContractFacts): string {
  const lines = [`CONTRACT "${f.title}"`]
  if (f.parties.length) lines.push(`  parties: ${f.parties.join(' / ')}`)
  if (f.effectiveDate) lines.push(`  effective date: ${f.effectiveDate} (stated in the contract)`)
  if (f.termLength) lines.push(`  initial term: ${f.termLength} (stated in the contract)`)
  if (f.termEnd) lines.push(`  initial term ends: COMPUTED ${f.termEnd.date}${renderDerivation(f.termEnd.derivation, f.termEnd.termLength)}`)
  for (const extra of f.extraLines ?? []) lines.push(`  ${extra}`)
  if (!f.current) lines.push(`  NOTE: this contract's analysis predates deadline extraction -- its obligations contributed NO dates.`)
  return lines.join('\n')
}

export function renderFinding(f: LoadedFinding, ordinal: number): string {
  const anchor = f.clauseId ? '' : ' -- this finding is about a clause the document does NOT contain'
  return `[${ordinal}] RISK | ${f.contractTitle} | ${f.severity} | ${f.kind}${anchor}\n    ${f.title}: ${f.reason}`
}

export function renderObligation(o: TrackedObligation, ordinal: number): string {
  const who = o.role ? `${o.obligor} (${o.role})` : o.obligor
  // The document's own wording always travels alongside the resolution, so
  // "when?" can be answered from what the contract actually says even when no
  // date could be derived from it.
  const stated = o.due ? `\n    timing as written: "${o.due}"` : ''
  return `[${ordinal}] OBLIGATION | ${o.contractTitle} | ${who}\n    must: ${o.action}${stated}\n    deadline: ${renderResolution(o.resolution)}`
}

// An attention item is a clause carrying BOTH a risk finding and an
// obligation, which is what makes a contract "need attention". It is numbered
// and citable because otherwise the single most valuable portfolio claim --
// "these contracts need attention" -- would have nothing to cite, and the
// model would state it bare. A live run did exactly that.
const URGENCY_WORDS: Record<string, string> = {
  overdue: ', whose deadline has already passed',
  soon: ', due within the next 30 days',
  upcoming: ', due more than 30 days from now',
}

export function renderAttentionItem(a: AttentionItem, ordinal: number): string {
  const who = a.role ? `${a.obligor} (${a.role})` : a.obligor
  // Words, not the enum, and not in brackets: a live answer wrote a bare
  // "[upcoming]" into its prose, where square brackets already mean "citation"
  // to every reader of this product.
  const when = a.urgency ? (URGENCY_WORDS[a.urgency] ?? '') : ''
  return `[${ordinal}] ATTENTION | ${a.contractTitle} | ${a.severity} risk on a clause that also carries a duty${when}
    risk: ${a.findingTitle}
    duty: ${who} must ${a.action}
    deadline: ${renderResolution(a.resolution)}`
}

// The attention tier as a sentence, not as its enum name.
//
// A live answer told the user a contract "is in the due_soon attention tier".
// That is an internal identifier in user-facing prose -- the same defect as
// leaking a UUID, just less obviously wrong because it happens to be
// readable. The model can only write what it is shown, so it is shown words.
const TIER_REASON: Record<AttentionTier, string> = {
  overdue_high_risk: 'a high-severity risk on a duty whose deadline has already passed',
  due_soon_high_risk: 'a high-severity risk on a duty due within the next 30 days',
  overdue: 'a dated duty whose deadline has already passed',
  due_soon: 'a dated milestone falling within the next 30 days',
  high_risk_undated: 'a high-severity risk that no date is attached to',
  monitored: 'nothing outstanding',
}

export function tierReason(tier: AttentionTier): string {
  return TIER_REASON[tier]
}

export interface ResolvedSourceCitation {
  ordinal: number
  contractId: string
  /** Exactly one of these is set. */
  clauseId: string | null
  findingId: string | null
}

/**
 * Map every [n] in an answer back to the record it points at.
 *
 * Shared by both scopes because the rule is the same in both: an ordinal
 * outside what the model was actually shown resolves to NOTHING, never to
 * whatever record happens to sit at that index. That is the difference
 * between a dropped citation and a confidently wrong link.
 */
export function resolveSourceCitations(text: string, sources: Source[]): ResolvedSourceCitation[] {
  const byOrdinal = new Map(sources.map((s) => [s.ordinal, s]))
  return extractCitationOrdinals(text)
    .map((n) => byOrdinal.get(n))
    .filter((s): s is Source => s !== undefined)
    .map((s) => ({
      ordinal: s.ordinal,
      contractId: s.contractId,
      clauseId: s.target.kind === 'clause' ? s.target.clauseId : null,
      findingId: s.target.kind === 'finding' ? s.target.findingId : null,
    }))
}

/**
 * Read one contract's lifecycle facts back out of an Intelligence bundle.
 *
 * `buildIntelligence` keeps the effective date and term end only on the
 * milestones it produced, so both scopes have to reconstruct the facts block
 * the same way. Doing it here rather than twice is what stops the two
 * assistants describing the same contract differently.
 */
export function contractFactsFor(
  bundle: { intelligence: { contracts: Array<{ contractId: string; title: string; current: boolean }>; milestones: Array<{ contractId: string; kind: string; date: string; termLength: string | null; derivation: Derivation | null }> }; partyNames: Record<string, string[]> },
  contractId: string,
  extraLines: string[] = [],
): ContractFacts | null {
  const row = bundle.intelligence.contracts.find((c) => c.contractId === contractId)
  if (!row) return null

  const facts: ContractFacts = {
    contractId,
    title: row.title,
    parties: bundle.partyNames[contractId] ?? [],
    effectiveDate: null,
    termLength: null,
    termEnd: null,
    current: row.current,
    extraLines,
  }

  for (const m of bundle.intelligence.milestones) {
    if (m.contractId !== contractId) continue
    if (m.kind === 'effective_date') facts.effectiveDate = m.date
    if (m.kind === 'term_end') {
      facts.termLength = m.termLength
      facts.termEnd = { date: m.date, derivation: m.derivation, termLength: m.termLength }
    }
  }

  return facts
}
