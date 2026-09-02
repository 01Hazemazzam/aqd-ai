// tests/chat/context-budget.test.ts
//
// Two decisions live here, and neither is visible from the outside -- the
// answer looks the same either way, which is exactly why they need tests.
//
//   1. The whole contract goes to the model when it fits, and retrieval only
//      runs when it does not. A silent regression to always-retrieve would
//      quietly re-cap multi-clause reasoning at six chunks and make NOT_FOUND
//      ambiguous again.
//   2. Condense runs ONLY on the retrieval path. Its output has only ever fed
//      the embedding call; on the full-context path it is up to a four-second
//      race the user waits behind for nothing.
//
// The budget is injected through the environment so the fallback genuinely
// executes here. A retrieval path that never runs in CI is a path that has
// already rotted by the time the first oversized contract arrives.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpc = vi.fn()
const embedTexts = vi.fn()
const aiComplete = vi.fn()
const streamGeminiText = vi.fn()

let clauseBodies: string[] = []
let priorMessages: Array<{ role: string; content: string; not_found: boolean }> = []

function q(data: unknown) {
  const first = () => (Array.isArray(data) ? (data[0] ?? null) : data)
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    in: () => obj,
    order: () => obj,
    limit: () => obj,
    insert: () => obj,
    maybeSingle: async () => ({ data: first(), error: null }),
    single: async () => ({ data: first(), error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data, error: null }),
  }
  return obj
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from: (table: string) => {
      switch (table) {
        case 'contracts':
          return q([{ id: 'contract-1', title: 'Orion MSA' }])
        case 'chats':
          return q([{ id: 'chat-1' }])
        case 'chat_messages':
          return q(priorMessages)
        case 'contract_versions':
          return q([{ id: 'version-1' }])
        case 'clauses':
          return q(clauseBodies.map((body, i) => ({ id: `clause-${i + 1}`, clause_number: String(i + 1), lang: 'en', body })))
        default:
          return q([])
      }
    },
    rpc,
  }),
}))
vi.mock('@/lib/org/current', () => ({ getCurrentOrgId: async () => 'org-1' }))
vi.mock('@/lib/ai/embed', () => ({ embedTexts, toPgVector: (v: number[]) => `[${v.join(',')}]` }))
vi.mock('@/lib/ai/router', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/router')>('@/lib/ai/router')
  return { ...actual, streamGeminiText, aiComplete }
})

async function drain(response: Response) {
  const reader = response.body!.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

/** Imports the route fresh so the budget constant picks up the env value. */
async function postWithBudget(budget: string | undefined, question: string) {
  vi.resetModules()
  if (budget === undefined) delete process.env.CHAT_CLAUSE_BUDGET_CHARS
  else process.env.CHAT_CLAUSE_BUDGET_CHARS = budget
  const { POST } = await import('@/app/api/chat/route')
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ contractId: 'contract-1', question }),
    }),
  )
  await drain(response)
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [{ id: 'clause-1', clause_number: '1', lang: 'en', body: 'Liability is limited.' }] })
  embedTexts.mockReset().mockResolvedValue([[0.1, 0.2]])
  aiComplete.mockReset().mockResolvedValue({ text: 'rewritten question' })
  streamGeminiText.mockReset().mockImplementation(async function* () {
    yield { textDelta: 'An answer [1].' }
  })
  clauseBodies = ['Liability is limited to fees paid.', 'Either party may terminate on 30 days notice.']
  priorMessages = []
})

afterEach(() => {
  delete process.env.CHAT_CLAUSE_BUDGET_CHARS
})

describe('contract chat :: choosing between the whole document and retrieval', () => {
  it('sends the whole contract and never embeds when it fits the budget', async () => {
    await postWithBudget(undefined, 'What are the termination rights?')

    expect(embedTexts).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()

    // Both clauses reached the model, which is the thing top-6 retrieval
    // could not promise.
    const [system] = streamGeminiText.mock.calls[0].slice(1)
    expect(system).toContain('Liability is limited to fees paid.')
    expect(system).toContain('Either party may terminate on 30 days notice.')
    expect(system).toContain('COMPLETE document')
  })

  it('falls back to retrieval once the document exceeds the budget', async () => {
    await postWithBudget('10', 'What are the termination rights?')

    expect(embedTexts).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledOnce()

    const [system] = streamGeminiText.mock.calls[0].slice(1)
    // The weaker claim, stated to the model explicitly: absence from these
    // excerpts is not absence from the document.
    expect(system).toContain('NOT the whole contract')
    expect(system).not.toContain('COMPLETE document')
  })
})

describe('contract chat :: when condense is worth its latency', () => {
  // A follow-up that genuinely needs the conversation to be understood.
  beforeEach(() => {
    priorMessages = [
      { role: 'user', content: 'What is the notice period for termination?', not_found: false },
      { role: 'assistant', content: 'Thirty days [1].', not_found: false },
    ]
  })

  it('does not run condense on the full-context path, where it buys nothing', async () => {
    await postWithBudget(undefined, 'And for the provider?')
    expect(aiComplete).not.toHaveBeenCalled()
  })

  it('still runs condense when retrieval is what will answer the question', async () => {
    await postWithBudget('10', 'And for the provider?')
    expect(aiComplete).toHaveBeenCalledOnce()
    // The rewrite steers retrieval only -- the model is still asked the
    // question the user actually typed.
    const [, , user] = streamGeminiText.mock.calls[0]
    expect(user).toBe('And for the provider?')
  })
})
