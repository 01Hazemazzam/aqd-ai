// Maps an obligation's obligor onto the contract's own parties.
//
// Positional, not semantic: `party_a`/`party_b` come from the contract's own
// extracted `parties` list rather than a fixed provider/customer taxonomy,
// because Aqd ingests contract types whose parties are landlord/tenant or
// employer/employee and a SaaS enum would mislabel them. The verbatim obligor
// is always kept and is what the UI shows -- this is a grouping key, not a
// replacement for what the document said.
//
// This is the FALLBACK path, for obligations extracted before the analysis
// schema started emitting a role. The extractor does it better because it has
// the clause in front of it and can follow the definitions section ("Provider"
// means Orion Ledger Technologies W.L.L.), which no string match can. So the
// rule here is to return null rather than guess: an unmapped obligation groups
// under its own verbatim text, which is honest, where a wrong mapping would
// silently attribute a duty to the wrong party.

export type PartyRole = 'party_a' | 'party_b' | 'both' | 'third_party'

// Phrasings that place a duty on everyone rather than on one side. A mutual
// obligation genuinely has more than one responsible party -- collapsing it
// onto whichever name appears first would lose that.
const MUTUAL = [
  'each party',
  'either party',
  'both parties',
  'parties',
  'all parties',
  'each of the parties',
  'affected party',
  'receiving party',
  'disclosing party',
  // Role-in-the-moment phrasings. The document names whichever side happens
  // to be sending, requesting or indemnifying at the time, which is a duty
  // that can fall on either of them -- not on a third party.
  'sending party',
  'notifying party',
  'requesting party',
  'indemnifying party',
  'indemnified party',
  'non-breaching party',
  'breaching party',
  'terminating party',
]

const MUTUAL_AR = ['الطرفان', 'الطرفين', 'كلا الطرفين', 'أي من الطرفين', 'كل طرف', 'الأطراف']

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:'"()‘’“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading article is not part of who the party is. Without this,
    // "affected party" mapped to `both` while "The affected party" -- the same
    // duty, worded differently three clauses later -- fell through to null and
    // grouped separately in the register. The live corpus contains both forms.
    .replace(/^(?:the|a|an) /, '')
}

/** Words too generic to identify a party by overlap alone. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'company', 'co', 'ltd', 'limited', 'llc', 'inc', 'w', 'l', 'wll', 'sa', 'plc', 'party',
])

function significantTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/**
 * The role an obligor plays, or null when it cannot be determined.
 *
 * `parties` is the contract's own extracted party list; the first two entries
 * define party_a and party_b. Returns null -- never a guess -- when the
 * obligor matches neither and is not a mutual phrasing.
 */
export function normalizeObligor(obligor: string | null | undefined, parties: string[]): PartyRole | null {
  if (!obligor?.trim()) return null
  const needle = normalize(obligor)

  if (MUTUAL.some((m) => needle === m || needle.startsWith(`${m} `))) return 'both'
  if (MUTUAL_AR.some((m) => obligor.includes(m))) return 'both'

  const roles: PartyRole[] = ['party_a', 'party_b']
  const candidates = parties.slice(0, 2).map(normalize)

  // An exact name match is unambiguous.
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && candidates[i] === needle) return roles[i]
  }

  // Otherwise a significant token shared with exactly one party -- "Orion
  // Ledger" against "Orion Ledger Technologies W.L.L.". Requiring exactly one
  // match is what keeps "Party" or "Company" from matching both.
  const needleTokens = new Set(significantTokens(obligor))
  const matched = candidates
    .map((c, i) => ({ role: roles[i], hit: significantTokens(c).some((t) => needleTokens.has(t)) }))
    .filter((c) => c.hit)

  if (matched.length === 1) return matched[0].role

  return null
}
