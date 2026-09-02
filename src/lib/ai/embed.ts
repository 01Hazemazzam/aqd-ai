import { AiDisabledError, AiUpstreamError } from './router'

const EMBED_DIMENSIONS = 768
const BATCH_SIZE = 100 // Google's batchEmbedContents request-count cap

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function embedBatch(texts: string[], apiKey: string, model: string, fetchImpl: typeof fetch): Promise<number[][]> {
  const attempts = Number(process.env.AI_RETRY_ATTEMPTS ?? 2)
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            requests: texts.map((text) => ({
              model: `models/${model}`,
              content: { parts: [{ text }] },
              outputDimensionality: EMBED_DIMENSIONS,
            })),
          }),
        },
      )

      if (!response.ok) {
        // Same hard-daily-quota reasoning as router.ts's callGemini: a 429
        // here has never once been transient in this app's real usage, and
        // embeddings have no fallback provider to retry into -- retrying
        // just delays an inevitable failure by up to 15s for nothing.
        const retryable = response.status >= 500
        throw new AiUpstreamError(`Gemini embed ${response.status}: ${await response.text()}`, retryable)
      }

      const body = await response.json()
      const embeddings: Array<{ values: number[] }> = body.embeddings ?? []
      if (embeddings.length !== texts.length) {
        throw new AiUpstreamError('Gemini embed returned a different count of vectors than requested', false)
      }
      return embeddings.map((e) => e.values)
    } catch (err) {
      lastError = err
      const retryable = err instanceof AiUpstreamError && err.retryable
      if (!retryable || attempt === attempts - 1) throw err
      await sleep(2 ** attempt * 1000)
    }
  }
  throw lastError
}

export async function embedTexts(texts: string[], opts?: { fetchImpl?: typeof fetch }): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new AiDisabledError('No API key configured for embeddings (GEMINI_API_KEY)')
  if (texts.length === 0) return []

  const fetchImpl = opts?.fetchImpl ?? fetch
  const model = process.env.AI_MODEL_EMBED ?? 'gemini-embedding-001'

  const results: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    results.push(...(await embedBatch(batch, apiKey, model, fetchImpl)))
  }
  return results
}

// pgvector's wire format for a `vector` column via PostgREST/supabase-js is
// a plain "[0.1,0.2,...]" string -- there's no native JS vector type.
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
