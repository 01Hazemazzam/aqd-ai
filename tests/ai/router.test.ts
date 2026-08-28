// tests/ai/router.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { aiComplete, callAnthropic, callGemini, AiDisabledError, AiUpstreamError } from '@/lib/ai/router'

const ANTHROPIC_SPEC = { provider: 'anthropic' as const, model: 'claude-test', inputPricePerMTok: 3, outputPricePerMTok: 15 }
const GEMINI_SPEC = { provider: 'gemini' as const, model: 'gemini-test', inputPricePerMTok: 0.1, outputPricePerMTok: 0.4 }

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('callAnthropic', () => {
  it('parses text, usage, and cost from a normal response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        content: [{ text: '{"summary":"hi"}' }],
        usage: { input_tokens: 1000, output_tokens: 500 },
        stop_reason: 'end_turn',
      }),
    )
    const result = await callAnthropic(ANTHROPIC_SPEC, 'key', 'sys', 'user', fetchImpl)
    expect(result.text).toBe('{"summary":"hi"}')
    expect(result.inputTokens).toBe(1000)
    expect(result.outputTokens).toBe(500)
    expect(result.costUsd).toBeCloseTo(1000 / 1_000_000 * 3 + 500 / 1_000_000 * 15)
  })

  it('throws non-retryable on max_tokens truncation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { content: [{ text: '{"incompl' }], usage: {}, stop_reason: 'max_tokens' }),
    )
    await expect(callAnthropic(ANTHROPIC_SPEC, 'key', 'sys', 'user', fetchImpl)).rejects.toMatchObject({
      name: 'AiUpstreamError',
      retryable: false,
    })
  })

  it('throws retryable on a 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate limited' }))
    const err = await callAnthropic(ANTHROPIC_SPEC, 'key', 'sys', 'user', fetchImpl).catch((e) => e)
    expect(err).toBeInstanceOf(AiUpstreamError)
    expect(err.retryable).toBe(true)
  })

  it('throws non-retryable on a 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'bad request' }))
    const err = await callAnthropic(ANTHROPIC_SPEC, 'key', 'sys', 'user', fetchImpl).catch((e) => e)
    expect(err.retryable).toBe(false)
  })
})

describe('callGemini', () => {
  it('parses text, usage, and cost from a normal response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: '{"summary":"hi"}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 },
      }),
    )
    const result = await callGemini(GEMINI_SPEC, 'key', 'sys', 'user', fetchImpl)
    expect(result.text).toBe('{"summary":"hi"}')
    expect(result.inputTokens).toBe(200)
    expect(result.outputTokens).toBe(80)
  })

  it('throws non-retryable when the prompt is safety-blocked (200 with no candidates)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }))
    const err = await callGemini(GEMINI_SPEC, 'key', 'sys', 'user', fetchImpl).catch((e) => e)
    expect(err).toBeInstanceOf(AiUpstreamError)
    expect(err.retryable).toBe(false)
  })

  it('throws non-retryable on MAX_TOKENS finishReason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{"incompl' }] }, finishReason: 'MAX_TOKENS' }] }),
    )
    const err = await callGemini(GEMINI_SPEC, 'key', 'sys', 'user', fetchImpl).catch((e) => e)
    expect(err.retryable).toBe(false)
  })
})

describe('aiComplete', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  const originalGeminiKey = process.env.GEMINI_API_KEY
  const originalRetryAttempts = process.env.AI_RETRY_ATTEMPTS

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
  })
  afterEach(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGeminiKey
    if (originalRetryAttempts === undefined) delete process.env.AI_RETRY_ATTEMPTS
    else process.env.AI_RETRY_ATTEMPTS = originalRetryAttempts
  })

  it('throws AiDisabledError when no key is configured for the tier', async () => {
    await expect(aiComplete('main', 'sys', 'user')).rejects.toBeInstanceOf(AiDisabledError)
  })

  it('retries a retryable failure and succeeds on a later attempt', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.AI_RETRY_ATTEMPTS = '3'
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: 'upstream down' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      )
    const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
    expect(result.text).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retry attempts on a persistently retryable failure', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.AI_RETRY_ATTEMPTS = '2'
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'still down' }))
    await expect(aiComplete('main', 'sys', 'user', { fetchImpl })).rejects.toBeInstanceOf(AiUpstreamError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable failure', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.AI_RETRY_ATTEMPTS = '4'
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'bad request' }))
    await expect(aiComplete('main', 'sys', 'user', { fetchImpl })).rejects.toBeInstanceOf(AiUpstreamError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
