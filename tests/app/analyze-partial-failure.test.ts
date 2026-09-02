// tests/app/analyze-partial-failure.test.ts
//
// P1 fix: a partially-failed analysis (some tasks succeed, some don't)
// previously saved as a plain 'ready' analysis with zero visible signal that
// anything went wrong -- the failed task's section just silently didn't
// appear. This proves the persisted row now carries error: 'partial' when
// exactly one of the five tasks fails, and error: null when all five
// succeed, using the actual production analyzeContract function against a
// mocked Supabase client shaped like the real schema.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/org/current', () => ({ getCurrentOrgId: async () => 'org-1' }))
vi.mock('@/lib/ai/prompts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/prompts')>('@/lib/ai/prompts')
  return {
    ...actual,
    summaryPrompt: () => ({ system: 'TASK:summary', user: '' }),
    fieldsPrompt: () => ({ system: 'TASK:fields', user: '' }),
    risksPrompt: () => ({ system: 'TASK:risks', user: '' }),
    crossClausePrompt: () => ({ system: 'TASK:cross', user: '' }),
    obligationsPrompt: () => ({ system: 'TASK:obligations', user: '' }),
  }
})

const aiComplete = vi.fn()
vi.mock('@/lib/ai/router', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/router')>('@/lib/ai/router')
  return { ...actual, aiComplete }
})

const analysesUpdate = vi.fn()
// null = cache miss (existing tests' behavior, unchanged). Set by the
// caching-bug test below to simulate a previous 'partial' analysis on the
// same content_hash.
let existingAnalysisRow: { id: string; status: string; error: string | null } | null = null

function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'contract_versions') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'version-1' } }) }) }) }) }) }
      }
      if (table === 'clauses') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'clause-1', clause_number: '1', body: 'Body text' }] }) }) }) }
      }
      if (table === 'analyses') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingAnalysisRow }) }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'analysis-1' } }) }) }),
          update: (payload: unknown) => {
            analysesUpdate(payload)
            // Two real call shapes hit this mock: the final `status: 'ready'`
            // update is awaited directly off `.eq(...)` (a plain object
            // works), but the existing-row reset chains `.eq(...).select('id').single()`
            // before awaiting -- so `.eq(...)` must be both a thenable AND
            // expose `.select()`, or the second shape throws.
            return {
              eq: (_column: string, value: string) => ({
                select: () => ({ single: async () => ({ data: { id: value }, error: null }) }),
                then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
              }),
            }
          },
        }
      }
      if (table === 'playbook_rules') {
        return { select: async () => ({ data: [] }) }
      }
      if (table === 'usage_events') {
        return { insert: async () => ({ error: null }) }
      }
      if (table === 'risk_findings') {
        return { delete: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) }
      }
      return {}
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => makeSupabase() }))

beforeEach(() => {
  aiComplete.mockReset()
  analysesUpdate.mockClear()
  existingAnalysisRow = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function jsonResult(payload: unknown) {
  return { text: JSON.stringify(payload), model: 'test-model', inputTokens: 1, outputTokens: 1, costUsd: 0 }
}

describe('analyzeContract partial-failure surfacing', () => {
  it('persists error: "partial" when exactly one of five tasks fails', async () => {
    aiComplete.mockImplementation(async (_tier: string, system: string) => {
      if (system === 'TASK:fields') throw new Error('malformed response')
      if (system === 'TASK:summary') return jsonResult({ summary: 'A summary.' })
      if (system === 'TASK:risks') return jsonResult({ findings: [] })
      if (system === 'TASK:cross') return jsonResult({ findings: [] })
      if (system === 'TASK:obligations') return jsonResult({ obligations: [] })
      throw new Error('unexpected task')
    })

    const { analyzeContract } = await import('@/app/(app)/contracts/[id]/analyze-actions')
    const result = await analyzeContract('contract-1')

    expect(result).toEqual({ analysisId: 'analysis-1', cached: false })
    const finalUpdate = analysesUpdate.mock.calls.find((c) => c[0].status === 'ready')
    expect(finalUpdate?.[0].error).toBe('partial')
    expect(finalUpdate?.[0].summary).toBe('A summary.')
    expect(finalUpdate?.[0].fields).toBeNull()
  })

  it('persists error: null when all five tasks succeed', async () => {
    aiComplete.mockImplementation(async (_tier: string, system: string) => {
      if (system === 'TASK:summary') return jsonResult({ summary: 'A summary.' })
      if (system === 'TASK:fields') return jsonResult({ parties: null, effectiveDate: null, termLength: null, governingLaw: null, totalValue: null })
      if (system === 'TASK:risks') return jsonResult({ findings: [] })
      if (system === 'TASK:cross') return jsonResult({ findings: [] })
      if (system === 'TASK:obligations') return jsonResult({ obligations: [] })
      throw new Error('unexpected task')
    })

    const { analyzeContract } = await import('@/app/(app)/contracts/[id]/analyze-actions')
    await analyzeContract('contract-1')

    const finalUpdate = analysesUpdate.mock.calls.find((c) => c[0].status === 'ready')
    expect(finalUpdate?.[0].error).toBeNull()
  })

  // Root cause of a real "clicking Re-analyze does nothing" report: the
  // content_hash cache check only looked at `status === 'ready'`, but a
  // partial analysis is ALSO status 'ready' (see the test above). Since the
  // source PDF's content_hash never changes, every subsequent Re-analyze
  // click short-circuited to the stale partial result with zero new AI
  // calls -- confirmed live via a 148ms response with no Gemini/OpenRouter
  // lines in the server log at all.
  it('does not short-circuit on a previous partial analysis -- Re-analyze must actually retry', async () => {
    existingAnalysisRow = { id: 'analysis-1', status: 'ready', error: 'partial' }
    aiComplete.mockImplementation(async (_tier: string, system: string) => {
      if (system === 'TASK:summary') return jsonResult({ summary: 'A summary.' })
      if (system === 'TASK:fields') return jsonResult({ parties: null, effectiveDate: null, termLength: null, governingLaw: null, totalValue: null })
      if (system === 'TASK:risks') return jsonResult({ findings: [] })
      if (system === 'TASK:cross') return jsonResult({ findings: [] })
      if (system === 'TASK:obligations') return jsonResult({ obligations: [] })
      throw new Error('unexpected task')
    })

    const { analyzeContract } = await import('@/app/(app)/contracts/[id]/analyze-actions')
    const result = await analyzeContract('contract-1')

    expect(result).toEqual({ analysisId: 'analysis-1', cached: false })
    expect(aiComplete).toHaveBeenCalledTimes(5)
    const finalUpdate = analysesUpdate.mock.calls.find((c) => c[0].status === 'ready')
    expect(finalUpdate?.[0].error).toBeNull()
  })

  it('does short-circuit on a previous fully-successful analysis, unchanged behavior', async () => {
    existingAnalysisRow = { id: 'analysis-1', status: 'ready', error: null }
    const { analyzeContract } = await import('@/app/(app)/contracts/[id]/analyze-actions')
    const result = await analyzeContract('contract-1')

    expect(result).toEqual({ analysisId: 'analysis-1', cached: true })
    expect(aiComplete).not.toHaveBeenCalled()
  })
})
