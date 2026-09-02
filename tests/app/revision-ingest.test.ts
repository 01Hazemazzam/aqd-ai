// tests/app/revision-ingest.test.ts
//
// `version_no` was hardcoded to 1 for as long as the ingest existed, and
// nothing failed when it was: the constraint it violates is `unique
// (contract_id, version_no)`, so the second draft of a contract did not
// produce a wrong version -- it produced no version at all, and an upload
// that reported "unknown error". These tests hold the numbering, and the two
// judgements the revision path makes that the first-upload path never had to:
// which failures are worth destroying an existing draft over, and when a
// second upload is not a revision at all.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/org/current', () => ({ getCurrentOrgId: async () => 'org-1' }))
vi.mock('@/lib/ai/embed', () => ({
  embedTexts: async (texts: string[]) => texts.map(() => [0.1, 0.2]),
  toPgVector: () => '[0.1,0.2]',
}))

const parseDocument = vi.fn(async () => '1. Payment\nThe Customer shall pay within thirty days.')
vi.mock('@/lib/ingest/parse', () => ({ parseDocument: (...args: unknown[]) => parseDocument(...(args as [])) }))

/** Rows the fake database starts a test with. */
let existingVersions: Array<{ version_no: number; file_id: string }> = []
let existingFile: { id: string } | null = null

const versionInsert = vi.fn()
const contractUpdate = vi.fn()

function makeSupabase() {
  return {
    storage: {
      from: () => ({
        download: async () => ({ data: { arrayBuffer: async () => new TextEncoder().encode('the file bytes').buffer }, error: null }),
      }),
    },
    from: (table: string) => {
      if (table === 'contract_versions') {
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: existingVersions }) }) }),
          insert: (payload: Record<string, unknown>) => {
            versionInsert(payload)
            return { select: () => ({ single: async () => ({ data: { id: 'version-new' }, error: null }) }) }
          },
        }
      }
      if (table === 'contract_files') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingFile }) }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'file-new' }, error: null }) }) }),
        }
      }
      if (table === 'clauses') {
        return {
          insert: () => ({ select: async () => ({ data: [{ id: 'clause-1', body: 'The Customer shall pay within thirty days.' }], error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'contracts') {
        return {
          update: (payload: Record<string, unknown>) => {
            contractUpdate(payload)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => makeSupabase() }))

const { ingestContract } = await import('@/app/(app)/contracts/actions')

beforeEach(() => {
  existingVersions = []
  existingFile = null
  versionInsert.mockClear()
  contractUpdate.mockClear()
  parseDocument.mockClear()
  parseDocument.mockResolvedValue('1. Payment\nThe Customer shall pay within thirty days.')
})

const ingest = () => ingestContract('contract-1', 'org-1/contract-1/draft.docx', 'draft.docx', 'application/pdf')

describe('ingestContract :: version numbering', () => {
  it('numbers the first upload version 1', async () => {
    const result = await ingest()

    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({ version_no: 1 }))
    expect(result).toEqual(expect.objectContaining({ versionNo: 1 }))
  })

  it('numbers a revision after the highest version the contract has', async () => {
    existingVersions = [{ version_no: 2, file_id: 'file-2' }, { version_no: 1, file_id: 'file-1' }]

    const result = await ingest()

    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({ version_no: 3 }))
    expect(result).toEqual(expect.objectContaining({ versionNo: 3 }))
  })
})

describe('ingestContract :: a second upload that is not a revision', () => {
  // Uploading the same bytes again is a slip, not a draft. Storing it would
  // produce a comparison whose every clause is unchanged -- a page that takes
  // a minute to read and says nothing.
  it('refuses a file identical to a version the contract already has', async () => {
    existingFile = { id: 'file-1' }
    existingVersions = [{ version_no: 1, file_id: 'file-1' }]

    const result = await ingest()

    expect(result).toEqual({ error: 'unchanged_file' })
    expect(versionInsert).not.toHaveBeenCalled()
    expect(contractUpdate).not.toHaveBeenCalled()
  })

  // The same bytes filed under a DIFFERENT contract are a genuine revision of
  // this one -- one party's amended draft is routinely another contract's
  // starting point, and the org-wide checksum row is shared.
  it('accepts a file the org has seen on another contract', async () => {
    existingFile = { id: 'file-elsewhere' }
    existingVersions = [{ version_no: 1, file_id: 'file-1' }]

    const result = await ingest()

    expect(versionInsert).toHaveBeenCalledWith(expect.objectContaining({ version_no: 2, file_id: 'file-elsewhere' }))
    expect(result).toEqual(expect.objectContaining({ versionNo: 2 }))
  })
})

describe('ingestContract :: what a failed upload is allowed to destroy', () => {
  it('marks a contract failed when its first and only document will not parse', async () => {
    parseDocument.mockRejectedValue(new Error('unreadable'))

    const result = await ingest()

    expect(result).toEqual({ error: 'parse_failed' })
    expect(contractUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  // The draft already in there is intact and still readable. Burning the
  // contract down because a second file was corrupt would lose real work over
  // an upload the user can simply retry.
  it('leaves a contract readable when a revision will not parse', async () => {
    existingVersions = [{ version_no: 1, file_id: 'file-1' }]
    parseDocument.mockRejectedValue(new Error('unreadable'))

    const result = await ingest()

    expect(result).toEqual({ error: 'parse_failed' })
    expect(contractUpdate).not.toHaveBeenCalled()
  })

  // Parsing moved ahead of every write for this reason: a version row with no
  // clauses under it renders as a contract that lost its text.
  it('writes no version at all when the document will not parse', async () => {
    parseDocument.mockRejectedValue(new Error('unreadable'))

    await ingest()

    expect(versionInsert).not.toHaveBeenCalled()
  })
})
