// Builds a cross-contract obligations register out of the free-text `due`
// strings the analysis extractor produces. The extractor is deliberately told
// NOT to compute dates -- `due` is "the stated deadline or trigger in the
// document's own words, or null" (see obligationsPrompt) -- so most dues are
// natural language: a concrete date ("June 30, 2026"), a trigger ("within 30
// days of termination"), a recurrence ("annually"), or null. This helper
// places only the genuinely concrete dates on a timeline and leaves everything
// else as conditional, rather than inventing a calendar date the document
// never stated.
//
// Pure and deterministic: `today` is injected (never read from the clock
// inside), so the whole thing is unit-testable through this one interface.

export interface RawObligation {
  contractId: string
  contractTitle: string
  obligor: string
  action: string
  due: string | null
}

export type Urgency = 'overdue' | 'soon' | 'upcoming'

export interface DatedObligation extends RawObligation {
  /** ISO yyyy-mm-dd, parsed from `due`. */
  dueDate: string
  urgency: Urgency
}

export interface ObligationRegister {
  /** Concrete-date obligations, sorted ascending by dueDate. */
  dated: DatedObligation[]
  /** Trigger-based, recurring, or undated obligations, order preserved. */
  conditional: RawObligation[]
}

// An obligation is "soon" if its deadline is within this many days of `today`.
const SOON_DAYS = 30

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

function utc(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day)
}

// Only accepts strings that ARE a full calendar date end-to-end (anchored),
// which is what excludes "within 30 days of..." phrases without a separate
// blocklist -- a phrase can't match an anchored date pattern. Numeric slash
// formats (DD/MM/YYYY vs MM/DD/YYYY) are deliberately NOT parsed: their
// day/month order is ambiguous and guessing risks a wrong date, which is worse
// than leaving the obligation in the conditional list. Returns a UTC-midnight
// epoch or null.
function parseConcreteDate(due: string): number | null {
  const text = due.trim()

  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]))

  m = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)
  if (m) {
    const month = MONTHS[m[1].toLowerCase()]
    if (month !== undefined) return utc(Number(m[3]), month, Number(m[2]))
  }

  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/)
  if (m) {
    const month = MONTHS[m[2].toLowerCase()]
    if (month !== undefined) return utc(Number(m[3]), month, Number(m[1]))
  }

  return null
}

function urgencyFor(dueEpoch: number, today: Date): Urgency {
  const todayEpoch = utc(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const days = Math.floor((dueEpoch - todayEpoch) / 86_400_000)
  if (days < 0) return 'overdue'
  if (days <= SOON_DAYS) return 'soon'
  return 'upcoming'
}

export function buildObligationRegister(rows: RawObligation[], today: Date): ObligationRegister {
  const dated: DatedObligation[] = []
  const conditional: RawObligation[] = []

  for (const row of rows) {
    const epoch = row.due ? parseConcreteDate(row.due) : null
    if (epoch === null) {
      conditional.push(row)
      continue
    }
    dated.push({
      ...row,
      dueDate: new Date(epoch).toISOString().slice(0, 10),
      urgency: urgencyFor(epoch, today),
    })
  }

  // ISO date strings sort lexically in chronological order.
  dated.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return { dated, conditional }
}
