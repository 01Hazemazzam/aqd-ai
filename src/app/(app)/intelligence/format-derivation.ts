import type { Derivation } from '@/lib/intelligence/due-spec'

// Writes a derivation as a sentence in the reader's language.
//
// The arithmetic lives in the pure module, which knows how the date was
// reached but not the words for it; this is the other half. Kept out of the
// views so both the calendar and the obligations list phrase it identically --
// the whole value of showing a derivation is that the reader learns to read
// it, which fails if two screens word it differently.

export interface DerivationStrings {
  /** "From" / "مستمدّ من" */
  derivedFrom: string
  /** The comma between the anchor and the interval. Arabic uses U+060C
      ("،"), not the Latin comma -- punctuation is part of the language, and
      hardcoding one of them gets the other subtly wrong. */
  separator: string
  anchor: { absolute_date: string; effective_date: string; term_end: string }
  direction: { before: string; after: string }
  unit: { day: string; week: string; month: string; year: string }
}

export function formatDerivation(
  derivation: Derivation | null,
  strings: DerivationStrings,
  formatDate: (iso: string) => string,
  /** A term end is "effective date plus <the document's own term wording>",
      which is more honest than restating it as a month count the document
      never wrote. */
  termLength?: string | null,
): string | null {
  if (!derivation) return null

  const anchor = `${strings.anchor[derivation.anchor]} ${formatDate(derivation.anchorDate)}`

  if (termLength) return `${anchor} ${strings.direction.after} ${termLength}`

  // An hours-level interval lands on the anchor's own day, so the document's
  // phrase is shown instead of an offset the calendar cannot represent.
  if (derivation.verbatim) return `${anchor} (${derivation.verbatim})`

  if (derivation.offset === null || derivation.unit === null || derivation.direction === null) return anchor

  const unit = derivation.unit === 'hour' || derivation.unit === 'business_day' ? 'day' : derivation.unit
  const direction = derivation.direction === 'before' ? strings.direction.before : strings.direction.after

  return `${anchor}${strings.separator} ${direction} ${derivation.offset} ${strings.unit[unit]}`
}
