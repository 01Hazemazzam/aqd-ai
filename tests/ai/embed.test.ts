// tests/ai/embed.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { embedTexts, toPgVector } from '@/lib/ai/embed'
import { AiDisabledError, AiUpstreamError } from '@/lib/ai/router'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('toPgVector', () => {
  it('formats a number array as pgvector wire text', () => {
    expect(toPgVector([0.1, -0.2, 0.3])).toBe('[0.1,-0.2,0.3]')
  })

  it('formats an empty array', () => {
    expect(toPgVector([])).toBe('[]')
  })
})

describe('embedTexts', () => {
  const originalKey = process.env.GEMINI_API_KEY
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
  })
  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalKey
  })

  it('throws AiDisabledError with no key configured', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(embedTexts(['a'])).rejects.toBeInstanceOf(AiDisabledError)
  })

  it('returns an empty array for empty input without calling the API', async () => {
    const fetchImpl = vi.fn()
    expect(await embedTexts([], { fetchImpl })).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns one vector per input text, in order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }),
    )
    const result = await embedTexts(['clause one', 'clause two'], { fetchImpl })
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]])
  })

  it('throws non-retryable if the response has a different vector count than requested', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { embeddings: [{ values: [0.1] }] }))
    const err = await embedTexts(['a', 'b'], { fetchImpl }).catch((e) => e)
    expect(err).toBeInstanceOf(AiUpstreamError)
    expect(err.retryable).toBe(false)
  })

  it('retries a transient 500 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: 'upstream down' }))
      .mockResolvedValueOnce(jsonResponse(200, { embeddings: [{ values: [0.5] }] }))
    const result = await embedTexts(['a'], { fetchImpl })
    expect(result).toEqual([[0.5]])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // Embeddings have no fallback provider (see ingestContract's catch, which
  // just logs and moves on) -- a real 429 has always been a hard daily quota
  // (qa/FINDINGS.md), so retrying it before giving up only delayed the
  // inevitable failure by up to 15s during upload for nothing. This is the
  // fix for the user-reported "upload takes forever" latency.
  it('does not retry a 429 -- fails on the first attempt so upload does not stall on a dead quota', async () => {
    process.env.AI_RETRY_ATTEMPTS = '4'
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'quota exceeded' }))
    await expect(embedTexts(['a'], { fetchImpl })).rejects.toBeInstanceOf(AiUpstreamError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('batches requests larger than the 100-item cap into multiple calls', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return jsonResponse(200, { embeddings: body.requests.map(() => ({ values: [1] })) })
    })
    const texts = Array.from({ length: 150 }, (_, i) => `clause ${i}`)
    const result = await embedTexts(texts, { fetchImpl })
    expect(result).toHaveLength(150)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
