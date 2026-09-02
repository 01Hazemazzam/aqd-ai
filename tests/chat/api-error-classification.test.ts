// tests/chat/api-error-classification.test.ts
//
// Root-cause coverage for a live-reproduced bug: every chat question was
// rendering "Something went wrong answering that" with zero trace of why --
// not just a generic message, the real error was never logged anywhere,
// server or client. Live evidence: 5+ real /api/chat calls each took ~9s
// (the exact fetchStreamWithRetry backoff shape for a persistent 429) and
// left nothing containing "429" or "RESOURCE_EXHAUSTED" in the dev server
// log at all. Root cause was the same Gemini main-tier free-tier daily
// quota exhaustion already documented for the analysis pipeline (see
// qa/FINDINGS.md) -- route.ts's catch block just never logged anything and
// collapsed every AiUpstreamError into one generic 'upstream_failed'. This
// covers the fix: the real error is now logged, and a 429 specifically
// classifies as 'quota_exceeded' instead of the generic code.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
let priorMessages: Array<{ role: string; content: string; not_found: boolean }> = []
function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'contracts') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'contract-1' } }) }) }) }
      }
      if (table === 'chats') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'chat-1' } }) }) }) }
      }
      if (table === 'chat_messages') {
        return {
          // The route reads prior turns before inserting this one, so a
          // follow-up can be rewritten against the conversation.
          select: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: priorMessages }) }) }),
          }),
          insert: async () => ({ data: null, error: null }),
        }
      }
      return { insert: async () => ({ data: null, error: null }) }
    },
    rpc,
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => makeSupabase() }))
vi.mock('@/lib/org/current', () => ({ getCurrentOrgId: async () => 'org-1' }))
vi.mock('@/lib/ai/embed', () => ({
  embedTexts: async () => [[0.1, 0.2]],
  toPgVector: (v: number[]) => `[${v.join(',')}]`,
}))

const streamGeminiText = vi.fn()
vi.mock('@/lib/ai/router', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/router')>('@/lib/ai/router')
  return { ...actual, streamGeminiText }
})

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({
    data: [{ id: 'clause-1', clause_number: '7', lang: 'en', body: 'Liability is limited.' }],
  })
  streamGeminiText.mockReset()
  priorMessages = []
})

async function readSSE(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: Array<{ event: string; data: unknown }> = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const eventLine = frame.split('\n').find((l) => l.startsWith('event:'))
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      events.push({ event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) })
    }
  }
  return events
}

function chatRequest(body: unknown) {
  return new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) })
}

describe('POST /api/chat error classification', () => {
  it('classifies a real Gemini 429 as quota_exceeded, with the real message logged, not swallowed', async () => {
    const { AiUpstreamError } = await import('@/lib/ai/router')
    streamGeminiText.mockImplementation(async function* () {
      throw new AiUpstreamError('Gemini stream 429: {"error":{"status":"RESOURCE_EXHAUSTED"}}', true, 429)
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/chat/route')
    const events = await readSSE(await POST(chatRequest({ contractId: 'contract-1', question: 'How much liability?' })))

    expect(events.find((e) => e.event === 'error')?.data).toEqual({ error: 'quota_exceeded' })
    expect(errorSpy).toHaveBeenCalledWith('[chat] request failed:', expect.stringContaining('RESOURCE_EXHAUSTED'))
    errorSpy.mockRestore()
  })

  it('classifies a non-429 upstream error as upstream_failed, not quota_exceeded', async () => {
    const { AiUpstreamError } = await import('@/lib/ai/router')
    streamGeminiText.mockImplementation(async function* () {
      throw new AiUpstreamError('Gemini stream 500: internal error', true, 500)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/chat/route')
    const events = await readSSE(await POST(chatRequest({ contractId: 'contract-1', question: 'q' })))
    expect(events.find((e) => e.event === 'error')?.data).toEqual({ error: 'upstream_failed' })
  })

  it('classifies a missing API key as ai_disabled', async () => {
    const { AiDisabledError } = await import('@/lib/ai/router')
    streamGeminiText.mockImplementation(async function* () {
      throw new AiDisabledError('No API key configured for provider "gemini"')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/chat/route')
    const events = await readSSE(await POST(chatRequest({ contractId: 'contract-1', question: 'q' })))
    expect(events.find((e) => e.event === 'error')?.data).toEqual({ error: 'ai_disabled' })
  })
})
