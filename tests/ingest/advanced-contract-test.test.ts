// tests/ingest/advanced-contract-test.test.ts
// @vitest-environment node
//
// Regression coverage for a real user-reported PDF (tests/fixtures/
// advanced-contract-test.pdf, a 4-page, 28-clause synthetic contract). Two
// defects were found by running the actual production parseDocument/
// segmentClauses against it, not by inspection:
//
// 1. Real bug, fixed here: unpdf's merged text has no page-boundary
//    markers, so this PDF's running header/footer ("Aqd AI synthetic QA
//    contract - testing only Page N") got interleaved into whatever clause
//    was open at each page break -- Clause 8 ended with "...until service
//    is restored.\nAqd AI synthetic QA contract - testing only Page 2\nFor
//    Severity 2 incidents...", contaminating its body. Fixed in parse.ts by
//    extracting per-page and stripping lines that repeat (modulo a page
//    number) across nearly every page, detected structurally rather than by
//    matching this fixture's specific text.
//
// 2. NOT an Aqd bug -- confirmed and left as documented, asserted behavior:
//    Clause 27's body is written entirely in Arabic. Direct inspection of
//    pdf.js's own per-page getTextContent() (not just unpdf's wrapper) shows
//    zero text items for that entire line -- the Arabic run occupies real
//    visual space in the rendered page but was never encoded as selectable
//    text in the PDF's content stream (most likely rendered as vector
//    outlines, a known behavior of some PDF generators for complex scripts
//    they can't embed as real text). No text-layer extraction library --
//    unpdf, pdf.js, or otherwise -- can recover text that was never encoded
//    as text. This is a source-document defect, not a parsing defect: the
//    parser correctly extracts every character that IS real text.
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from '@/lib/ingest/parse'
import { segmentClauses } from '@/lib/ingest/segment'

async function parseFixture() {
  const bytes = await readFile(path.join(__dirname, '../fixtures/advanced-contract-test.pdf'))
  return parseDocument(new Uint8Array(bytes), 'application/pdf')
}

describe('advanced-contract-test.pdf (real user-reported fixture)', () => {
  it('segments into all 28 clauses with no page-boundary header/footer contamination', async () => {
    const rawText = await parseFixture()
    expect(rawText).not.toMatch(/testing only/)
    expect(rawText).not.toMatch(/Page \d/)

    const clauses = segmentClauses(rawText)
    expect(clauses).toHaveLength(28)
    for (const clause of clauses) {
      expect(clause.body).not.toMatch(/testing only/)
      expect(clause.body).not.toMatch(/Page \d/)
    }
  })

  it('preserves genuinely one-off text that is not a repeating header/footer', async () => {
    const rawText = await parseFixture()
    // Appears once, on the last page only -- must survive the running-line strip.
    expect(rawText).toContain('Synthetic QA document - for testing Aqd AI only. Not an operative legal agreement.')
  })

  it('still produces Clause 27, though its Arabic body is unrecoverable from this PDF\'s text layer', async () => {
    const rawText = await parseFixture()
    // Documents the real, external limitation described above -- not a gap
    // this test expects to close, so an unexpected recovery here (e.g. from
    // a future unpdf/pdf.js upgrade that changes glyph handling) is worth
    // knowing about via a failing test, not silently absorbed.
    expect(rawText).not.toMatch(/[؀-ۿ]/)

    const clauses = segmentClauses(rawText)
    const clause27 = clauses.find((c) => c.clauseNumber === '27')
    expect(clause27).toBeDefined()
    expect(clause27!.body).toContain('Arabic Operational Provision')
  })
})
