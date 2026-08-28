export interface PromptClause {
  id: string
  clauseNumber: string | null
  body: string
}

export interface PlaybookRule {
  ruleKey: string
  title: string
  description: string
  severityHint: 'high' | 'medium' | 'low'
}

const HARD_RULES = `Hard rules:
- Base every answer only on the clause text provided. Never invent a fact that isn't in the document.
- When a value is genuinely absent from the document, use JSON null -- never guess or fabricate a plausible-sounding value.
- Reference clauses only by the "id" field given to you. Never invent a clause id.
- A finding about a clause the document is missing entirely (e.g. no termination clause) uses "clauseId": null.
- Output must be a single JSON object and nothing else -- no markdown fences, no commentary before or after.`

function renderClauses(clauses: PromptClause[]): string {
  return clauses
    .map((c) => `[id=${c.id}]${c.clauseNumber ? ` (clause ${c.clauseNumber})` : ''}\n${c.body}`)
    .join('\n\n')
}

export function summaryPrompt(clauses: PromptClause[]) {
  return {
    system: `You are a contract analyst. Summarize the contract below in 2-4 plain-language sentences a business reader can act on. ${HARD_RULES}\n\nRespond with JSON: {"summary": string}.`,
    user: renderClauses(clauses),
  }
}

export function fieldsPrompt(clauses: PromptClause[]) {
  return {
    system: `You are a contract analyst extracting key fields. ${HARD_RULES}\n\nRespond with JSON matching exactly this shape:\n{"parties": string[] | null, "effectiveDate": string | null, "termLength": string | null, "governingLaw": string | null, "totalValue": string | null}`,
    user: renderClauses(clauses),
  }
}

export function risksPrompt(clauses: PromptClause[], rules: PlaybookRule[]) {
  const ruleList = rules
    .map((r) => `- ${r.ruleKey}: ${r.title} -- ${r.description} (typical severity: ${r.severityHint})`)
    .join('\n')
  return {
    system: `You are a contract risk reviewer. Score the contract against this playbook of rules:\n${ruleList}\n\n${HARD_RULES}\n\nFor each rule, only report a finding if the contract actually violates it or is missing something the rule requires -- do not report a finding for a rule the contract already satisfies. Respond with JSON: {"findings": [{"clauseId": string | null, "ruleKey": string, "severity": "high" | "medium" | "low", "title": string, "reason": string, "reasonAr": string}]}. "reasonAr" is the same reason written in Arabic. An empty findings array is a valid answer.`,
    user: renderClauses(clauses),
  }
}

export function obligationsPrompt(clauses: PromptClause[]) {
  return {
    system: `You are a contract analyst extracting obligations -- who must do what, by when. ${HARD_RULES}\n\nRespond with JSON: {"obligations": [{"clauseId": string | null, "obligor": string, "action": string, "due": string | null}]}. "due" is the stated deadline or trigger in the document's own words, or null if none is stated. Do not compute or infer a date that isn't written in the document. An empty obligations array is a valid answer.`,
    user: renderClauses(clauses),
  }
}

export class MalformedAiResponseError extends Error {
  constructor(task: string, cause: unknown) {
    super(`Malformed AI response for task "${task}": ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'MalformedAiResponseError'
  }
}

export function extractJson<T>(task: string, text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  try {
    return JSON.parse(candidate.trim()) as T
  } catch (err) {
    throw new MalformedAiResponseError(task, err)
  }
}
