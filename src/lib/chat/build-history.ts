export interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  not_found: boolean
}

export interface StoredCitation {
  message_id: string
  ordinal: number
  clause_id: string
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  notFound: boolean
  citations: Array<{ ordinal: number; clauseId: string; clauseNumber: string | null }>
}

// Extracted from contracts/[id]/page.tsx so the mapping (in particular: a
// not_found row must render the translated refusal text, not the literal
// "NOT_FOUND" sentinel string persisted by the chat route) has direct unit
// coverage without a React render or a next-intl client provider.
export function buildChatHistory(
  messages: StoredChatMessage[],
  citations: StoredCitation[],
  clauseNumberById: Map<string, string | null>,
  notFoundText: string,
): HistoryMessage[] {
  const citationsByMessage = new Map<string, HistoryMessage['citations']>()
  for (const c of citations) {
    const list = citationsByMessage.get(c.message_id) ?? []
    list.push({ ordinal: c.ordinal, clauseId: c.clause_id, clauseNumber: clauseNumberById.get(c.clause_id) ?? null })
    citationsByMessage.set(c.message_id, list)
  }

  return messages.map((m) => ({
    role: m.role,
    content: m.not_found ? notFoundText : m.content,
    notFound: m.not_found,
    citations: citationsByMessage.get(m.id) ?? [],
  }))
}
