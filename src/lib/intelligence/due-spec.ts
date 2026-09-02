// Turns an extracted due specification into a calendar date, or says why it
// cannot be one.
//
// The extractor reads the SHAPE of a deadline out of the clause -- "at least
// sixty (60) days before the end of the then-current term" becomes offset 60,
// unit day, direction before, anchor term_end -- and this module does the
// arithmetic. Splitting it that way is what makes a date on a legal calendar
// defensible: the model reads, code computes, and every resolved date can be
// traced back through its derivation to a verified quote.
//
// See ADR-0003. The rule that governs every branch below: resolve only when
// the anchor is a date the CONTRACT states. An interval the document gives
// ("within 30 days of receipt") is not a deadline until something dates the
// event, and nothing here may assume when receipt happened.
//
// Pure and deterministic: `resolveDue` is a function of (spec, facts) alone.

import { addDays, addMonths, initialTermEnd, parseStatedDate } from './dates'

/** What a due specification counts from. Closed by design -- a new member
    without a resolution rule that traces to a stated fact is a fabricated
    deadline waiting to happen. */
export type Anchor = 'absolute_date' | 'effective_date' | 'term_end' | 'contract_event' | 'none'

export type Direction = 'before' | 'after' | 'on'

export type OffsetUnit = 'hour' | 'day' | 'business_day' | 'week' | 'month' | 'year'

export interface DueSpec {
  /** The deadline phrase exactly as the document writes it. */
  verbatim: string
  offset: number | null
  unit: OffsetUnit | null
  direction: Direction | null
  anchor: Anchor
  /** Only for anchor 'absolute_date': the date the document names. */
  anchorDate: string | null
}

export type ResolutionStatus = 'resolved' | 'unresolved' | 'no_deadline_stated'

export type UnresolvedReason =
  /** The anchor is an event the contract never dates (receipt, termination). */
  | 'anchor_not_dated'
  /** term_end anchor, but the contract does not state effective date + term. */
  | 'term_not_stated'
  /** effective_date anchor, but no effective date was extracted. */
  | 'effective_date_not_stated'
  /** Business days depend on a holiday calendar the contract does not give. */
  | 'unit_not_computable'
  /** The spec is missing a part it needs to compute anything. */
  | 'incomplete_spec'

export interface Resolution {
  status: ResolutionStatus
  /** ISO yyyy-mm-dd when status is 'resolved'. */
  date: string | null
  reason: UnresolvedReason | null
  /** Human-readable arithmetic behind the date, shown to the user instead of
      a confidence score -- "initial term end 2028-05-31, minus 60 days". */
  derivation: string | null
}

export interface ContractFacts {
  effectiveDate: string | null
  termLength: string | null
}

const UNIT_DAYS: Partial<Record<OffsetUnit, number>> = { day: 1, week: 7 }

function unresolved(reason: UnresolvedReason): Resolution {
  return { status: 'unresolved', date: null, reason, derivation: null }
}

function anchorLabel(anchor: Anchor): string {
  return anchor === 'term_end' ? 'initial term end' : anchor === 'effective_date' ? 'effective date' : 'stated date'
}

/**
 * Resolve a due specification against the facts the contract states.
 *
 * Returns 'no_deadline_stated' when there is no specification at all -- the
 * obligation exists but the document sets no time for it, which is a real and
 * common answer, not a failure.
 */
export function resolveDue(spec: DueSpec | null | undefined, facts: ContractFacts): Resolution {
  if (!spec || spec.anchor === 'none') {
    return { status: 'no_deadline_stated', date: null, reason: null, derivation: null }
  }

  // Named for what it is: the contract states an interval from an event whose
  // date it never gives. Assuming a date for "termination" or "receipt" would
  // invent the deadline outright, so this is terminal, not a gap to close
  // later. 38 of 147 real obligations land here.
  if (spec.anchor === 'contract_event') return unresolved('anchor_not_dated')

  // A business day excludes weekends and public holidays; the contracts define
  // the term but never enumerate the holidays, so the exact date genuinely is
  // not computable from the document.
  if (spec.unit === 'business_day') return unresolved('unit_not_computable')

  let base: string | null
  if (spec.anchor === 'absolute_date') {
    base = parseStatedDate(spec.anchorDate)
    if (base === null) return unresolved('incomplete_spec')
  } else if (spec.anchor === 'effective_date') {
    base = parseStatedDate(facts.effectiveDate)
    if (base === null) return unresolved('effective_date_not_stated')
  } else {
    base = initialTermEnd(facts.effectiveDate, facts.termLength)
    if (base === null) return unresolved('term_not_stated')
  }

  // "On the effective date" -- an anchor with no interval is already the date.
  if (spec.direction === 'on' || spec.offset === null || spec.offset === 0 || spec.unit === null) {
    return {
      status: 'resolved',
      date: base,
      reason: null,
      derivation: `${anchorLabel(spec.anchor)} ${base}`,
    }
  }

  if (spec.direction === null) return unresolved('incomplete_spec')

  // An hour-level interval ("within 72 hours") resolves to the same calendar
  // day it starts from; the calendar's unit is the day, so carrying the hours
  // would imply a precision the timeline cannot show.
  if (spec.unit === 'hour') {
    return {
      status: 'resolved',
      date: base,
      reason: null,
      derivation: `${anchorLabel(spec.anchor)} ${base} (${spec.verbatim})`,
    }
  }

  const sign = spec.direction === 'before' ? -1 : 1
  const days = UNIT_DAYS[spec.unit]
  const date =
    days !== undefined ? addDays(base, sign * spec.offset * days) : addMonths(base, sign * spec.offset * (spec.unit === 'year' ? 12 : 1))

  if (date === null) return unresolved('incomplete_spec')

  const unitWord = spec.unit === 'week' ? 'week' : spec.unit
  return {
    status: 'resolved',
    date,
    reason: null,
    derivation: `${anchorLabel(spec.anchor)} ${base}, ${spec.direction === 'before' ? 'minus' : 'plus'} ${spec.offset} ${unitWord}${spec.offset === 1 ? '' : 's'}`,
  }
}
