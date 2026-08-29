// tests/ai/router.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { aiComplete, callAnthropic, callGemini, callOpenRouter, streamGeminiText, AiDisabledError, AiUpstreamError } from '@/lib/ai/router'

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
    expect(result.provider).toBe('anthropic')
    expect(result.requestedModel).toBe(ANTHROPIC_SPEC.model)
    expect(result.inputTokens).toBe(1000)
    expect(result.outputTokens).toBe(500)
    expect(result.costUsd).toBeCloseTo(1000 / 1_000_000 * 3 + 500 / 1_000_000 * 15)
  })

  it('records the resolved model from the response body, not the requested alias', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        content: [{ text: 'ok' }],
        usage: {},
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-5-20250929',
      }),
    )
    const result = await callAnthropic({ ...ANTHROPIC_SPEC, model: 'claude-sonnet-4-5-latest' }, 'key', 'sys', 'user', fetchImpl)
    expect(result.model).toBe('claude-sonnet-4-5-20250929')
  })

  it('falls back to the requested model if the response omits one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ text: 'ok' }], usage: {}, stop_reason: 'end_turn' }))
    const result = await callAnthropic(ANTHROPIC_SPEC, 'key', 'sys', 'user', fetchImpl)
    expect(result.model).toBe(ANTHROPIC_SPEC.model)
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

  // Every real 429 this app has hit (Gemini, at least -- see qa/FINDINGS.md)
  // has been a hard free-tier DAILY quota, not a transient rate limit --
  // confirmed live by a retry immediately failing with the identical 429
  // again. Retryable is reserved for 5xx now; a 429 skips straight to
  // whatever fallback exists instead of wasting up to 15s of backoff on a
  // retry that has never once succeeded.
  it('throws non-retryable on a 429 (daily quota exhaustion, not a transient limit)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate limited' }))
    const err = await callAnthropic(ANTHROPIC_SPEC, 'key', 'sys', 'user', fetchImpl).catch((e) => e)
    expect(err).toBeInstanceOf(AiUpstreamError)
    expect(err.retryable).toBe(false)
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
    expect(result.provider).toBe('gemini')
    expect(result.requestedModel).toBe(GEMINI_SPEC.model)
    expect(result.inputTokens).toBe(200)
    expect(result.outputTokens).toBe(80)
  })

  it('records the resolved modelVersion, not the requested rolling alias', async () => {
    // A real "gemini-flash-lite-latest" call resolved to "gemini-3.5-flash-lite"
    // -- this is the exact shape that response had.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: {},
        modelVersion: 'gemini-3.5-flash-lite',
      }),
    )
    const result = await callGemini({ ...GEMINI_SPEC, model: 'gemini-flash-lite-latest' }, 'key', 'sys', 'user', fetchImpl)
    expect(result.model).toBe('gemini-3.5-flash-lite')
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

describe('callOpenRouter', () => {
  it('parses text, usage, and cost (zero, for the $0-credit free-tier key) from a normal response', async () => {
    const spec = { provider: 'openrouter' as const, model: 'openai/gpt-oss-20b:free', inputPricePerMTok: 0, outputPricePerMTok: 0 }
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
        model: 'openai/gpt-oss-20b:free',
      }),
    )
    const result = await callOpenRouter(spec, 'key', 'sys', 'user', fetchImpl)
    expect(result.text).toBe('ok')
    expect(result.provider).toBe('openrouter')
    expect(result.requestedModel).toBe(spec.model)
    expect(result.inputTokens).toBe(50)
    expect(result.outputTokens).toBe(10)
    expect(result.costUsd).toBe(0)
    const [, requestInit] = fetchImpl.mock.calls[0]
    expect(JSON.parse(requestInit.body).messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ])
  })

  it('throws non-retryable when the response has no message content', async () => {
    const spec = { provider: 'openrouter' as const, model: 'm', inputPricePerMTok: 0, outputPricePerMTok: 0 }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: {} }] }))
    const err = await callOpenRouter(spec, 'key', 'sys', 'user', fetchImpl).catch((e) => e)
    expect(err).toBeInstanceOf(AiUpstreamError)
    expect(err.retryable).toBe(false)
  })
})

describe('aiComplete', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  const originalGeminiKey = process.env.GEMINI_API_KEY
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
  const originalRetryAttempts = process.env.AI_RETRY_ATTEMPTS
  const originalForceProvider = process.env.AI_FORCE_PROVIDER
  const originalFallbackEnabled = process.env.AI_FALLBACK_ENABLED

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.AI_FORCE_PROVIDER
    delete process.env.AI_FALLBACK_ENABLED
  })
  afterEach(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGeminiKey
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    if (originalRetryAttempts === undefined) delete process.env.AI_RETRY_ATTEMPTS
    else process.env.AI_RETRY_ATTEMPTS = originalRetryAttempts
    if (originalForceProvider === undefined) delete process.env.AI_FORCE_PROVIDER
    else process.env.AI_FORCE_PROVIDER = originalForceProvider
    if (originalFallbackEnabled === undefined) delete process.env.AI_FALLBACK_ENABLED
    else process.env.AI_FALLBACK_ENABLED = originalFallbackEnabled
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

  it('does not retry a 429 either -- fails on the first attempt instead of backing off', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.AI_RETRY_ATTEMPTS = '4'
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'quota exceeded' }))
    await expect(aiComplete('main', 'sys', 'user', { fetchImpl })).rejects.toBeInstanceOf(AiUpstreamError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // The three tests below cover the actual fix for the tracked Gemini
  // free-tier quota ceiling: prefer Gemini/Anthropic while they're healthy,
  // fall back to OpenRouter only when they're not -- and only when
  // OPENROUTER_API_KEY is configured at all, so this is purely additive.
  describe('OpenRouter fallback', () => {
    it('never touches OpenRouter when the primary provider succeeds normally', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse(200, {
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      )
      const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
      expect(result.text).toBe('ok')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(fetchImpl.mock.calls[0][0]).not.toContain('openrouter')
    })

    it('falls back to OpenRouter immediately on a 429, without retrying Gemini first', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_RETRY_ATTEMPTS = '4' // high on purpose -- proves retryable=false skips backoff, not just a low cap
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          return jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} })
        }
        return jsonResponse(429, { error: 'quota exceeded' })
      })
      const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
      expect(result.text).toBe('fallback answer')
      // 1 Gemini attempt (429, not retried) + 1 OpenRouter call.
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('still retries a genuinely transient 500 before falling back', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_RETRY_ATTEMPTS = '2'
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          return jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} })
        }
        return jsonResponse(500, { error: 'upstream down' })
      })
      const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
      expect(result.text).toBe('fallback answer')
      // 2 Gemini attempts (both 500, exhausting AI_RETRY_ATTEMPTS) + 1 OpenRouter call.
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('falls back to OpenRouter when the primary tier has no key configured at all', async () => {
      process.env.OPENROUTER_API_KEY = 'or-key'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} }))
      const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
      expect(result.text).toBe('fallback answer')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('throws the original error when OpenRouter is configured but also fails', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_RETRY_ATTEMPTS = '1'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'everything is down' }))
      const err = await aiComplete('main', 'sys', 'user', { fetchImpl }).catch((e) => e)
      expect(err).toBeInstanceOf(AiUpstreamError)
      expect(err.message).toContain('Gemini 429')
    })

    it('still throws AiDisabledError with no key anywhere, OpenRouter included', async () => {
      await expect(aiComplete('main', 'sys', 'user')).rejects.toBeInstanceOf(AiDisabledError)
    })
  })

  // AI_FALLBACK_ENABLED=false: a QA run validating Gemini's own behavior
  // needs to see its real failure, not have OpenRouter silently mask it.
  describe('AI_FALLBACK_ENABLED=false', () => {
    it('does not fall back to OpenRouter even though a key is configured', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_FALLBACK_ENABLED = 'false'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'quota exceeded' }))
      const err = await aiComplete('main', 'sys', 'user', { fetchImpl }).catch((e) => e)
      expect(err).toBeInstanceOf(AiUpstreamError)
      expect(err.message).toContain('Gemini 429')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('openrouter'))).toBe(true)
    })

    it('any other value leaves fallback on (only the literal string "false" disables it)', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_FALLBACK_ENABLED = 'no'
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          return jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} })
        }
        return jsonResponse(429, { error: 'quota exceeded' })
      })
      const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
      expect(result.text).toBe('fallback answer')
    })
  })

  // AI_FORCE_PROVIDER=openrouter: explicit developer selection, for proving
  // the OpenRouter path works without needing a real Gemini outage.
  describe('AI_FORCE_PROVIDER=openrouter', () => {
    it('routes straight to OpenRouter, skipping Gemini entirely even though it would have succeeded', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_FORCE_PROVIDER = 'openrouter'
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          return jsonResponse(200, { choices: [{ message: { content: 'openrouter answer' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
        }
        throw new Error('should never call Gemini when a provider is forced')
      })
      const result = await aiComplete('main', 'sys', 'user', { fetchImpl })
      expect(result.text).toBe('openrouter answer')
      expect(result.provider).toBe('openrouter')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('throws AiDisabledError when forced to OpenRouter without an OpenRouter key, even though Gemini has one', async () => {
      process.env.GEMINI_API_KEY = 'test-key'
      process.env.AI_FORCE_PROVIDER = 'openrouter'
      const fetchImpl = vi.fn()
      await expect(aiComplete('main', 'sys', 'user', { fetchImpl })).rejects.toBeInstanceOf(AiDisabledError)
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })
})

// Streams a raw SSE body through a real ReadableStream, split into
// arbitrary read()-sized pieces, so the test exercises the same
// incremental-decode path streamGeminiText actually runs in production.
function sseStreamResponse(rawBody: string, chunkSize = 40) {
  const bytes = new TextEncoder().encode(rawBody)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream, text: async () => rawBody } as unknown as Response
}

describe('streamGeminiText', () => {
  const originalKey = process.env.GEMINI_API_KEY
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
  const originalForceProvider = process.env.AI_FORCE_PROVIDER
  const originalFallbackEnabled = process.env.AI_FALLBACK_ENABLED
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    // A real OPENROUTER_API_KEY may be present in .env.local (loaded by
    // tests/setup.ts) -- cleared here so every test in this describe block
    // is insulated from it by default, the same discipline already applied
    // to GEMINI_API_KEY/ANTHROPIC_API_KEY. Tests that actually exercise the
    // fallback set it back explicitly in their own nested describe below.
    delete process.env.OPENROUTER_API_KEY
    delete process.env.AI_FORCE_PROVIDER
    delete process.env.AI_FALLBACK_ENABLED
  })
  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalKey
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    if (originalForceProvider === undefined) delete process.env.AI_FORCE_PROVIDER
    else process.env.AI_FORCE_PROVIDER = originalForceProvider
    if (originalFallbackEnabled === undefined) delete process.env.AI_FALLBACK_ENABLED
    else process.env.AI_FALLBACK_ENABLED = originalFallbackEnabled
  })

  async function collect(gen: AsyncGenerator<{ textDelta: string }>) {
    const chunks: string[] = []
    for await (const c of gen) chunks.push(c.textDelta)
    return chunks
  }

  it('yields text deltas from a CRLF-terminated SSE stream (the real Gemini wire format)', async () => {
    // A real Gemini streamGenerateContent response failed to yield ANY
    // chunks because it uses \r\n\r\n frame separators, not the bare \n\n
    // this parser originally assumed -- confirmed by capturing a real
    // response body. This fixture reproduces that exact format.
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":"Cats are"}]}}]}\r\n\r\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":" independent."}]}}]}\r\n\r\n'
    const fetchImpl = vi.fn().mockResolvedValue(sseStreamResponse(body))
    const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
    expect(chunks).toEqual(['Cats are', ' independent.'])
  })

  it('also handles bare-LF frame separators, in case that ever changes', async () => {
    const body = 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n'
    const fetchImpl = vi.fn().mockResolvedValue(sseStreamResponse(body))
    const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
    expect(chunks).toEqual(['hi'])
  })

  it('reassembles a frame split across multiple stream reads', async () => {
    const body = 'data: {"candidates":[{"content":{"parts":[{"text":"split text"}]}}]}\r\n\r\n'
    const fetchImpl = vi.fn().mockResolvedValue(sseStreamResponse(body, 5)) // tiny chunks force a mid-frame split
    const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
    expect(chunks).toEqual(['split text'])
  })

  it('throws AiDisabledError with no key configured', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(collect(streamGeminiText('main', 'sys', 'user'))).rejects.toBeInstanceOf(AiDisabledError)
  })

  it('throws when the tier resolves to a non-Gemini provider', async () => {
    await expect(collect(streamGeminiText('heavy', 'sys', 'user'))).rejects.toMatchObject({ name: 'AiUpstreamError' })
  })

  // A live chat request failed with a real 429 RESOURCE_EXHAUSTED that Google's own error body
  // advertised a ~6s retry delay for -- but streamGeminiText had no retry loop at all (unlike
  // aiComplete), so the user saw an immediate "something went wrong" instead of a transparent
  // retry. This only retries the initial request, before any tokens have reached the client.
  describe('retry on a transient failure before streaming starts', () => {
    const originalRetryAttempts = process.env.AI_RETRY_ATTEMPTS
    afterEach(() => {
      if (originalRetryAttempts === undefined) delete process.env.AI_RETRY_ATTEMPTS
      else process.env.AI_RETRY_ATTEMPTS = originalRetryAttempts
    })

    it('retries a transient 500 and streams normally once a later attempt succeeds', async () => {
      process.env.AI_RETRY_ATTEMPTS = '3'
      const body = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\r\n\r\n'
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(500, { error: 'upstream down' }))
        .mockResolvedValueOnce(sseStreamResponse(body))
      const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
      expect(chunks).toEqual(['ok'])
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('gives up after exhausting retry attempts on a persistent 500', async () => {
      process.env.AI_RETRY_ATTEMPTS = '2'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'still down' }))
      await expect(collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))).rejects.toBeInstanceOf(AiUpstreamError)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    // The fix for the user-reported "upload/analyze takes forever" latency:
    // every real 429 this app hits is a hard daily quota (see qa/FINDINGS.md),
    // so retrying it can never succeed within the backoff window -- it just
    // delays reaching the fallback. Proven here with a high retry cap so a
    // pass can't be mistaken for "the cap happened to be low."
    it('does not retry a 429 -- fails on the first attempt regardless of retry budget', async () => {
      process.env.AI_RETRY_ATTEMPTS = '4'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'quota exceeded' }))
      await expect(collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))).rejects.toBeInstanceOf(AiUpstreamError)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('does not retry a non-retryable failure (e.g. a blocked prompt reported as 400)', async () => {
      process.env.AI_RETRY_ATTEMPTS = '4'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'bad request' }))
      await expect(collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))).rejects.toBeInstanceOf(AiUpstreamError)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
  })

  describe('OpenRouter fallback (necessarily non-streamed: one chunk instead of many)', () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
    afterEach(() => {
      if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    })

    it('falls back after Gemini streaming exhausts its retries on a persistent 429', async () => {
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_RETRY_ATTEMPTS = '1'
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          return jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} })
        }
        return jsonResponse(429, { error: 'quota exceeded' })
      })
      const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
      expect(chunks).toEqual(['fallback answer'])
    })

    it('falls back with no Gemini key configured at all', async () => {
      delete process.env.GEMINI_API_KEY
      process.env.OPENROUTER_API_KEY = 'or-key'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} }))
      const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
      expect(chunks).toEqual(['fallback answer'])
    })

    it('still throws when OpenRouter is unset, preserving prior behavior exactly', async () => {
      delete process.env.OPENROUTER_API_KEY
      process.env.AI_RETRY_ATTEMPTS = '1'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'quota exceeded' }))
      await expect(collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))).rejects.toBeInstanceOf(AiUpstreamError)
    })

    it('does not fall back when AI_FALLBACK_ENABLED=false, even with a key configured', async () => {
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_FALLBACK_ENABLED = 'false'
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'quota exceeded' }))
      await expect(collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))).rejects.toBeInstanceOf(AiUpstreamError)
      expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('openrouter'))).toBe(true)
    })
  })

  describe('AI_FORCE_PROVIDER=openrouter', () => {
    it('routes straight to OpenRouter as a single chunk, skipping the Gemini stream entirely', async () => {
      process.env.OPENROUTER_API_KEY = 'or-key'
      process.env.AI_FORCE_PROVIDER = 'openrouter'
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          return jsonResponse(200, { choices: [{ message: { content: 'openrouter answer' } }], usage: {} })
        }
        throw new Error('should never call Gemini when a provider is forced')
      })
      const chunks = await collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))
      expect(chunks).toEqual(['openrouter answer'])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('throws AiDisabledError when forced without an OpenRouter key, even though Gemini has one', async () => {
      process.env.AI_FORCE_PROVIDER = 'openrouter'
      const fetchImpl = vi.fn()
      await expect(collect(streamGeminiText('main', 'sys', 'user', { fetchImpl }))).rejects.toBeInstanceOf(AiDisabledError)
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })
})
