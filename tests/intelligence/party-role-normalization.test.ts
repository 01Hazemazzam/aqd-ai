// tests/intelligence/party-role-normalization.test.ts
//
// QA found the obligations register listing the same responsible party under
// several spellings -- "either party" beside "Either party", "affected party"
// beside "The affected party" -- so one duty appeared to belong to several
// different actors. Every string below is taken verbatim from the obligors in
// the live corpus.
import { describe, it, expect } from 'vitest'
import { normalizeObligor } from '@/lib/intelligence/party-role'

const PARTIES = ['Orion Ledger Systems Ltd.', 'Crescent Peak Wholesale W.L.L.']

describe('normalizeObligor :: spellings of the same actor', () => {
  it('maps every casing of a mutual phrasing to the same role', () => {
    for (const obligor of ['either party', 'Either party', 'both parties', 'Both parties', 'Each party', 'each party', 'the parties', 'The Parties']) {
      expect(normalizeObligor(obligor, PARTIES), obligor).toBe('both')
    }
  })

  // The specific miss: a leading article made an identical duty fall through
  // to null and group under its own verbatim text.
  it('sees through a leading article', () => {
    for (const obligor of ['affected party', 'the affected party', 'The affected party', 'An affected party']) {
      expect(normalizeObligor(obligor, PARTIES), obligor).toBe('both')
    }
  })

  it('maps role-in-the-moment phrasings, which either side can occupy', () => {
    for (const obligor of ['The sending party', 'the requesting party', 'Indemnifying Party', 'the non-breaching party']) {
      expect(normalizeObligor(obligor, PARTIES), obligor).toBe('both')
    }
  })

  it('still maps a named party to its own side', () => {
    expect(normalizeObligor('Provider', ['Provider', 'Customer'])).toBe('party_a')
    expect(normalizeObligor('Customer', ['Provider', 'Customer'])).toBe('party_b')
    expect(normalizeObligor('Orion Ledger', PARTIES)).toBe('party_a')
  })
})

describe('normalizeObligor :: things that are not a party at all', () => {
  // Both are real obligors in the corpus -- the extractor took a sentence
  // subject for a responsible party. Guessing a role for them would attribute
  // a duty to someone the document never named, so null is the honest answer
  // and the register shows the verbatim text instead.
  it('refuses to invent a role for a subject that is not an actor', () => {
    expect(normalizeObligor('Any renewal-term pricing', PARTIES)).toBeNull()
    expect(normalizeObligor('Unauthorized disclosure discovered by a party', PARTIES)).toBeNull()
  })

  it('returns null rather than guessing when the obligor matches neither party', () => {
    expect(normalizeObligor('The auditor', PARTIES)).toBeNull()
    expect(normalizeObligor('', PARTIES)).toBeNull()
    expect(normalizeObligor(null, PARTIES)).toBeNull()
  })

  // "a party" names no side in particular; treating it as mutual would assert
  // that BOTH owe the duty, which the document did not say.
  it('does not read a bare "a party" as both parties', () => {
    expect(normalizeObligor('a party', PARTIES)).toBeNull()
  })
})
