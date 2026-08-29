export interface SegmentedClause {
  ordinal: number
  clauseNumber: string | null
  lang: 'ar' | 'en'
  body: string
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const DIGIT_CLASS = `[0-9${ARABIC_DIGITS}]`

// Ordered heading patterns, tried top-to-bottom per line. Each captures the
// clause number (group 1) and the text that follows the marker on the same
// line (group 2). "Article 12 —" and "١٢. " are both markers; a bare "12"
// inside a sentence is not, which is why every pattern anchors to line start.
const HEADING_PATTERNS: RegExp[] = [
  new RegExp(`^(?:المادة|البند)\\s*(?:رقم)?\\s*[:\\-]?\\s*(\\(?${DIGIT_CLASS}+\\)?)\\s*[:\\-]?\\s*(.*)$`),
  /^(?:Article|Section|Clause)\s+(\d+(?:\.\d+)*)\s*[:.\-]?\s*(.*)$/i,
  new RegExp(`^(${DIGIT_CLASS}+(?:\\.${DIGIT_CLASS}+)*)[.)]\\s+(.*)$`),
]

function matchHeading(line: string): { clauseNumber: string; rest: string } | null {
  const trimmed = line.trim()
  for (const pattern of HEADING_PATTERNS) {
    const match = pattern.exec(trimmed)
    if (match) return { clauseNumber: match[1], rest: match[2] ?? '' }
  }
  return null
}

function detectLang(text: string): 'ar' | 'en' {
  const arabicChars = text.match(/[؀-ۿ]/g)?.length ?? 0
  const latinChars = text.match(/[A-Za-z]/g)?.length ?? 0
  return arabicChars > latinChars ? 'ar' : 'en'
}

interface RawClause {
  clauseNumber: string | null
  lines: string[]
}

// Lines before the first recognized heading (a title, a party/date table, a
// recital paragraph) previously had nowhere to go: `current` is still null
// at that point, and the `else if (current)` branch silently drops them.
// That's exactly where a real contract's party names typically live -- lost
// before any prompt ever saw them, which is why "Parties" extracted blank
// even though both names were explicit in the source document. Captured
// here as a leading, unnumbered clause instead, the same shape
// splitByParagraphs already uses for content with no clause numbering.
function splitByHeadings(lines: string[]): RawClause[] {
  const clauses: RawClause[] = []
  let current: RawClause | null = null
  const preamble: string[] = []

  for (const line of lines) {
    const heading = matchHeading(line)
    if (heading) {
      if (current) clauses.push(current)
      current = { clauseNumber: heading.clauseNumber, lines: heading.rest ? [heading.rest] : [] }
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) clauses.push(current)

  // Only worth keeping as its own clause when a real heading was found
  // later on -- for a document with NO headings at all, prepending it here
  // would collapse the whole thing into one undifferentiated blob instead
  // of correctly falling through to segmentClauses' own splitByParagraphs
  // fallback below (clauses.length === 0 is what triggers that).
  if (clauses.length > 0 && preamble.some((l) => l.trim())) {
    clauses.unshift({ clauseNumber: null, lines: preamble })
  }
  return clauses
}

// Documents with no recognizable clause numbering (a loose letter, a scanned
// memo) still need to render as something other than one giant block, so we
// fall back to paragraph breaks with no clause number attached.
function splitByParagraphs(text: string): RawClause[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ clauseNumber: null, lines: [paragraph] }))
}

export function segmentClauses(rawText: string): SegmentedClause[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n')
  const headingClauses = splitByHeadings(lines)
  const raw = headingClauses.length > 0 ? headingClauses : splitByParagraphs(rawText)

  return raw
    .map((clause) => ({ ...clause, body: clause.lines.join('\n').trim() }))
    .filter((clause) => clause.body.length > 0)
    .map((clause, index) => ({
      ordinal: index + 1,
      clauseNumber: clause.clauseNumber,
      lang: detectLang(clause.body),
      body: clause.body,
    }))
}
