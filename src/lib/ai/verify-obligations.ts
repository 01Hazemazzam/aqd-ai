// Checks an extracted obligation's timing structure against the clause it
// came from, so a resolved deadline is grounded in code rather than trusted
// from the prompt.
//
// The risk here is subtler than a fabricated quote. A due specification is
// mostly numbers and enum values, and a model that mis-reads "sixty (60) days
// AFTER termination" as "BEFORE the term end" produces a perfectly
// well-formed record that resolves to a confident, wrong date on a legal
// calendar. So the specification is only accepted when its verbatim phrase is
// genuinely in the clause and the parts it claims are consistent with that
// phrase -- the number it cites must actually appear in the words it quoted.
//
// A rejected specification does NOT reject the obligation: the obligation is
// real and still worth listing, it just loses its date and says so. That is
// the same conservative direction as everywhere else here -- an obligation
// with no deadline is a true statement, a wrong deadline is not.
//
// Pure and deterministic: a function of (obligations, clauses) alone.

import type { Anchor, Direction, DueSpec, OffsetUnit } from '@/lib/intelligence/due-spec'
import type { PartyRole } from '@/lib/intelligence/party-role'

export interface RawDueSpec {
  verbatim?: string | null
  offset?: number | string | null
  unit?: string | null
  direction?: string | null
  anchor?: string | null
  anchorDate?: string | null
}

export interface RawObligation {
  clauseId?: string | null
  obligor?: string | null
  partyRole?: string | null
  action?: string | null
  due?: string | null
  dueSpec?: RawDueSpec | null
}

export interface VerifiedObligation {
  clauseId: string | null
  obligor: string
  partyRole: PartyRole | null
  action: string
  due: string | null
  dueSpec: DueSpec | null
}

export type SpecRejection =
  /** The timing phrase is not in the cited clause. */
  | 'verbatim_not_in_clause'
  /** The offset it claims does not appear in the phrase it quoted. */
  | 'offset_not_in_phrase'
  /** anchor/unit/direction was not one of the allowed values. */
  | 'bad_enum'
  /** Anchored to a date the clause does not write out. */
  | 'anchor_date_not_in_clause'

export interface DroppedSpec {
  obligor: string
  action: string
  reason: SpecRejection
}

export interface ObligationVerification {
  obligations: VerifiedObligation[]
  droppedSpecs: DroppedSpec[]
}

const ANCHORS: readonly string[] = ['absolute_date', 'effective_date', 'term_end', 'contract_event', 'none']
const UNITS: readonly string[] = ['hour', 'day', 'business_day', 'week', 'month', 'year']
const DIRECTIONS: readonly string[] = ['before', 'after', 'on']
const ROLES: readonly string[] = ['party_a', 'party_b', 'both', 'third_party']

function normalize(text: string): string {
  return (
    text
      // Arabic extracted from PDFs often arrives in Presentation Forms
      // (U+FE70-FEFF) -- ﺳﺖ rather than ست -- which are the same letters in a
      // different encoding. NFKC folds them to the standard forms, so a quote
      // and a clause body compare as the text they are rather than as the
      // shaping the PDF happened to store.
      .normalize('NFKC')
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”‟″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/[  -   　]/g, ' ')
      .replace(/ـ/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  )
}

// Arabic-Indic digits appear in Arabic clauses; the number is the same number.
const ARABIC_DIGITS = /[٠-٩]/g
function foldDigits(text: string): string {
  return text.replace(ARABIC_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

// Number words, so "sixty days" corroborates offset 60 even where the clause
// writes no numeral. Only the values contracts actually use for periods.
const NUMBER_WORDS: Record<number, string[]> = {
  1: ['one'], 2: ['two'], 3: ['three'], 4: ['four'], 5: ['five'], 6: ['six'], 7: ['seven'],
  8: ['eight'], 9: ['nine'], 10: ['ten'], 12: ['twelve'], 14: ['fourteen'], 15: ['fifteen'],
  18: ['eighteen'], 20: ['twenty'], 21: ['twenty-one', 'twenty one'], 24: ['twenty-four', 'twenty four'],
  30: ['thirty'], 36: ['thirty-six', 'thirty six'], 45: ['forty-five', 'forty five'],
  48: ['forty-eight', 'forty eight'], 60: ['sixty'], 72: ['seventy-two', 'seventy two'],
  90: ['ninety'], 120: ['one hundred twenty', 'hundred and twenty'], 180: ['one hundred eighty'],
}

// Arabic writes numbers as words at least as often as numerals, and this is
// an Arabic-first product: without these, every deadline in an Arabic clause
// that spells its period out ("ست وثلاثين ساعة" -- thirty-six hours) was
// rejected as uncorroborated, which is a false negative on exactly the
// clauses the product exists to read.
const AR_UNITS: Record<number, string[]> = {
  1: ['واحد', 'واحدة'],
  2: ['اثنين', 'اثنتين', 'اثنان', 'اثنتان'],
  3: ['ثلاث', 'ثلاثة'],
  4: ['اربع', 'اربعة'],
  5: ['خمس', 'خمسة'],
  6: ['ست', 'ستة'],
  7: ['سبع', 'سبعة'],
  8: ['ثمان', 'ثماني', 'ثمانية'],
  9: ['تسع', 'تسعة'],
}
const AR_TENS: Record<number, string[]> = {
  10: ['عشر', 'عشرة'],
  20: ['عشرين', 'عشرون'],
  30: ['ثلاثين', 'ثلاثون'],
  40: ['اربعين', 'اربعون'],
  50: ['خمسين', 'خمسون'],
  60: ['ستين', 'ستون'],
  70: ['سبعين', 'سبعون'],
  80: ['ثمانين', 'ثمانون'],
  90: ['تسعين', 'تسعون'],
}

// Alef and ya carry orthographic variants that do not change the word.
function foldArabic(text: string): string {
  return text.replace(/[أإآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه')
}

function fold(list: string[]): string[] {
  return list.map(foldArabic)
}

/** Whether an Arabic phrase spells out `offset` -- "ست وثلاثين" for 36. */
function arabicStatesOffset(phrase: string, offset: number): boolean {
  const text = foldArabic(phrase)
  if (offset <= 0 || offset >= 100) return false

  const tens = Math.floor(offset / 10) * 10
  const units = offset % 10

  // A round ten needs only its own word; anything else needs both halves
  // present, which is what stops "ثلاثين" (30) corroborating a claimed 36.
  if (units === 0) return fold(AR_TENS[tens] ?? []).some((w) => text.includes(w))
  if (offset < 10) return fold(AR_UNITS[offset] ?? []).some((w) => text.includes(w))

  const tensHit = fold(AR_TENS[tens] ?? []).some((w) => text.includes(w))
  const unitsHit = fold(AR_UNITS[units] ?? []).some((w) => text.includes(w))
  return tensHit && unitsHit
}

/** Whether `phrase` actually contains the number the spec claims. */
function phraseStatesOffset(phrase: string, offset: number): boolean {
  const folded = foldDigits(phrase)
  if (new RegExp(`(?<!\\d)${offset}(?!\\d)`).test(folded)) return true
  if ((NUMBER_WORDS[offset] ?? []).some((w) => folded.includes(w))) return true
  return arabicStatesOffset(folded, offset)
}

// Anchors the model claims must be corroborated by the words it quoted, for
// the same reason offsets are.
//
// The failure this catches is real and was caught live: "for four (4) years
// after termination" and "For thirty (30) days after termination" both came
// back anchored to `term_end`, and resolved to confident, precise, wrong
// dates. Termination is an EVENT -- a contract can be terminated for cause in
// month three, or run through three renewals first -- and is not the same
// thing as the initial term expiring. The model conflated them because in
// plain English "the end of the term" and "termination" overlap; nothing in a
// well-formed record shows the difference, which is exactly why it needs a
// check rather than trust.
//
// Downgrading to `contract_event` rather than rejecting keeps the timing
// structure for display and lands on the safe outcome: no date at all.
const TERMINATION_EVENT = /\btermin(?:ation|ate[ds]?|ating)\b/i
const TERM_MARKERS = /\bterm\b|\brenew(?:al|s|ed|ing)?\b|\bexpir(?:y|ation|es)\b/i
const EFFECTIVE_MARKERS = /\beffective date\b|\bcommence(?:ment|s)?\b|\bstart date\b/i

const TERMINATION_EVENT_AR = /إنهاء|الإنهاء|انهاء/
const TERM_MARKERS_AR = /المدة|مدة|التجديد|تجديد|انتهاء المدة/
const EFFECTIVE_MARKERS_AR = /النفاذ|نفاذ|السريان|سريان|بدء/

/**
 * Whether the quoted phrase supports the anchor claimed for it.
 *
 * Returns false when the phrase names a termination event under a `term_end`
 * anchor, or when it carries none of the words that anchor would require.
 */
function anchorSupportedByPhrase(anchor: string, phrase: string): boolean {
  if (!phrase) return false

  if (anchor === 'term_end') {
    if (TERMINATION_EVENT.test(phrase) || TERMINATION_EVENT_AR.test(phrase)) return false
    return TERM_MARKERS.test(phrase) || TERM_MARKERS_AR.test(phrase)
  }

  if (anchor === 'effective_date') {
    return EFFECTIVE_MARKERS.test(phrase) || EFFECTIVE_MARKERS_AR.test(phrase)
  }

  return true
}

function toOffset(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Verify one due specification, returning it or the reason it was dropped.
 *
 * `clauseBody` is already normalized by the caller.
 */
function verifySpec(raw: RawDueSpec, clauseBody: string | null): { spec: DueSpec } | { reason: SpecRejection } {
  const anchor = raw.anchor ?? ''
  if (!ANCHORS.includes(anchor)) return { reason: 'bad_enum' }
  if (raw.unit && !UNITS.includes(raw.unit)) return { reason: 'bad_enum' }
  if (raw.direction && !DIRECTIONS.includes(raw.direction)) return { reason: 'bad_enum' }

  const verbatim = (raw.verbatim ?? '').trim()
  const offset = toOffset(raw.offset)

  // An unanchored specification claims nothing about timing, so there is
  // nothing to check it against and nothing it can resolve to.
  if (anchor !== 'none' && !verbatim) return { reason: 'verbatim_not_in_clause' }

  // The phrase must genuinely be in the clause. Without a clause to check
  // against (an obligation about a clause the document lacks) a specification
  // has no grounding at all, so it cannot be accepted.
  if (verbatim && anchor !== 'none') {
    if (clauseBody === null) return { reason: 'verbatim_not_in_clause' }
    if (!clauseBody.includes(normalize(verbatim))) return { reason: 'verbatim_not_in_clause' }
  }

  // The number must be in the words the model quoted. This is what catches a
  // plausible-looking spec whose figure came from somewhere else in the
  // clause, or from nowhere.
  if (offset !== null && offset > 0 && verbatim && !phraseStatesOffset(normalize(verbatim), offset)) {
    return { reason: 'offset_not_in_phrase' }
  }

  if (anchor === 'absolute_date') {
    const anchorDate = (raw.anchorDate ?? '').trim()
    if (!anchorDate) return { reason: 'anchor_date_not_in_clause' }
    if (clauseBody === null || !clauseBody.includes(normalize(anchorDate))) {
      return { reason: 'anchor_date_not_in_clause' }
    }
  }

  // A dateable anchor the quoted words do not support becomes the undateable
  // one. The obligation keeps its timing phrase; it just stops producing a
  // date nothing in the clause justifies.
  const finalAnchor: Anchor =
    (anchor === 'term_end' || anchor === 'effective_date') && !anchorSupportedByPhrase(anchor, verbatim)
      ? 'contract_event'
      : (anchor as Anchor)

  return {
    spec: {
      verbatim,
      offset,
      unit: (raw.unit as OffsetUnit | null) ?? null,
      direction: (raw.direction as Direction | null) ?? null,
      anchor: finalAnchor,
      anchorDate: raw.anchorDate?.trim() || null,
    },
  }
}

export function verifyObligations(
  obligations: RawObligation[],
  clauses: Array<{ id: string; body: string }>,
): ObligationVerification {
  const bodyById = new Map(clauses.map((c) => [c.id, normalize(c.body)]))
  const kept: VerifiedObligation[] = []
  const droppedSpecs: DroppedSpec[] = []

  for (const raw of obligations) {
    const obligor = (raw.obligor ?? '').trim()
    const action = (raw.action ?? '').trim()
    // Without an obligor and an action there is no obligation to speak of.
    if (!obligor || !action) continue

    const clauseId = raw.clauseId && bodyById.has(raw.clauseId) ? raw.clauseId : null
    const clauseBody = clauseId ? bodyById.get(clauseId)! : null

    let dueSpec: DueSpec | null = null
    if (raw.dueSpec) {
      const result = verifySpec(raw.dueSpec, clauseBody)
      if ('reason' in result) {
        // The obligation survives; only its timing is discarded. It will read
        // as "no deadline stated", which is a true statement about what we
        // can show, rather than a date nothing supports.
        droppedSpecs.push({ obligor, action, reason: result.reason })
      } else {
        dueSpec = result.spec
      }
    }

    kept.push({
      clauseId,
      obligor,
      partyRole: ROLES.includes(raw.partyRole ?? '') ? (raw.partyRole as PartyRole) : null,
      action,
      due: raw.due?.trim() || null,
      dueSpec,
    })
  }

  return { obligations: kept, droppedSpecs }
}
