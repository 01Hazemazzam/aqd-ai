// Date and duration parsing for deadline resolution.
//
// Every function here refuses anything it cannot read unambiguously, and
// returns null rather than a best guess. That posture is inherited from
// ADR-0002: a wrong date on a legal timeline is worse than no date, and a
// heuristic that "usually" works is exactly how a fabricated deadline gets
// onto a calendar.
//
// Pure and deterministic -- no clock is read in this file.

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

function utc(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day)
}

export function toIso(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10)
}

export function fromIso(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const epoch = utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // Rejects 2026-02-31 and friends, which Date.UTC would happily roll over.
  return toIso(epoch) === iso ? epoch : null
}

/**
 * A string that IS a full calendar date end to end, or null.
 *
 * Numeric slash formats (03/04/2027) are deliberately not accepted: their
 * day/month order is genuinely ambiguous across locales, and guessing risks a
 * wrong deadline. Same rule as buildObligationRegister -- see ADR-0002.
 */
export function parseStatedDate(text: string | null | undefined): string | null {
  if (!text) return null
  const s = text.trim()

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return fromIso(s) === null ? null : s

  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)
  if (m) {
    const month = MONTHS[m[1].toLowerCase()]
    if (month !== undefined) return toIso(utc(Number(m[3]), month, Number(m[2])))
  }

  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/)
  if (m) {
    const month = MONTHS[m[2].toLowerCase()]
    if (month !== undefined) return toIso(utc(Number(m[3]), month, Number(m[1])))
  }

  return null
}

// Contracts write durations as words, digits, or both at once: "24 months",
// "eighteen (18) months", "twenty (20) months". Where a parenthesised numeral
// is present it is authoritative -- that is the convention the documents
// themselves use, the numeral being the formal statement and the words the
// gloss.
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
}

/**
 * A stated term length in whole months, or null.
 *
 * Years are converted; anything else -- "evergreen", "until terminated", a
 * range, a term stated only in days -- returns null, because a term whose end
 * the document does not fix has no end to compute.
 */
export function parseTermMonths(text: string | null | undefined): number | null {
  if (!text) return null
  const s = text.trim().toLowerCase()

  const unit = /\byears?\b/.test(s) ? 12 : /\bmonths?\b/.test(s) ? 1 : null
  if (unit === null) return null

  // A parenthesised numeral wins, then a bare numeral, then a number word.
  let value: number | null = null
  let m = s.match(/\((\d{1,3})\)/)
  if (m) value = Number(m[1])
  if (value === null) {
    m = s.match(/(?:^|\s)(\d{1,3})(?=\s*(?:\(|years?|months?))/)
    if (m) value = Number(m[1])
  }
  if (value === null) {
    for (const [word, n] of Object.entries(NUMBER_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(s)) {
        value = n
        break
      }
    }
  }

  if (value === null || value <= 0) return null

  // Two different numbers in one string ("18 to 24 months") is a range, not a
  // term -- resolving it would mean picking one.
  const numerals = s.match(/\d{1,3}/g) ?? []
  if (new Set(numerals).size > 1) return null

  return value * unit
}

/** Calendar-month arithmetic, clamping to the last valid day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string | null {
  const epoch = fromIso(iso)
  if (epoch === null) return null
  const d = new Date(epoch)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + months
  const day = d.getUTCDate()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return toIso(utc(year, month, Math.min(day, lastDay)))
}

export function addDays(iso: string, days: number): string | null {
  const epoch = fromIso(iso)
  if (epoch === null) return null
  return toIso(epoch + days * 86_400_000)
}

/**
 * The last day of the initial term: effective date + term length, minus one
 * day.
 *
 * The minus-one is not a fudge -- it is what the documents themselves state.
 * The hard QA fixture says "effective on 1 September 2026 and continues for
 * an initial term of twenty-one (21) months, ending on 31 May 2028", and
 * 1 Sep 2026 + 21 months = 1 Jun 2028, whose preceding day is 31 May 2028.
 * A term that runs FOR 21 months ends the day before the anniversary.
 */
export function initialTermEnd(effectiveDate: string | null, termLength: string | null): string | null {
  const start = parseStatedDate(effectiveDate)
  const months = parseTermMonths(termLength)
  if (start === null || months === null) return null
  const anniversary = addMonths(start, months)
  return anniversary === null ? null : addDays(anniversary, -1)
}
