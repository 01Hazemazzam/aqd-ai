'use server'
import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { sha256Hex } from '@/lib/ingest/checksum'
import { aiComplete, type Tier } from '@/lib/ai/router'
import { classifyAnalysisError, mapTaskError, type TaskErrorInfo } from '@/lib/ai/classify-error'
import { verifyFindings } from '@/lib/ai/verify-findings'
import {
  summaryPrompt,
  fieldsPrompt,
  risksPrompt,
  obligationsPrompt,
  extractJson,
  type PromptClause,
  type PlaybookRule,
} from '@/lib/ai/prompts'

type SummaryOutput = { summary: string }
type FieldsOutput = {
  parties: string[] | null
  effectiveDate: string | null
  termLength: string | null
  governingLaw: string | null
  totalValue: string | null
}
type RiskFinding = {
  clauseId: string | null
  ruleKey: string | null
  severity: 'high' | 'medium' | 'low'
  title: string
  reason: string
  reasonAr: string
  evidence: string | null
}
type RisksOutput = { findings: RiskFinding[] }
type Obligation = { clauseId: string | null; obligor: string; action: string; due: string | null }
type ObligationsOutput = { obligations: Obligation[] }

// Preserved per-failure (not just logged) so a total failure across all four
// tasks can report *why* (quota exhausted vs. no key vs. something else)
// instead of collapsing every non-disabled failure into one generic
// "unknown" the UI can't distinguish from a real bug -- the gap that made a
// genuine, provable 429 quota exhaustion render as "something went wrong."
interface TaskRun<T> extends TaskErrorInfo {
  ok: boolean
  data: T | null
}

// Not exported: a 'use server' file's exports must all be async functions
// usable as Server Actions, and this is an internal helper with a
// non-serializable (function) parameter -- classification logic that needs
// direct unit coverage lives in classify-error.ts instead.
async function runTask<T>(
  task: string,
  tier: Tier,
  prompt: { system: string; user: string },
  logUsage: (row: {
    task: string
    provider: string
    requestedModel: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  }) => Promise<void>,
): Promise<TaskRun<T>> {
  try {
    const result = await aiComplete(tier, prompt.system, prompt.user)
    await logUsage({
      task,
      provider: result.provider,
      requestedModel: result.requestedModel,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    })
    return { ok: true, data: extractJson<T>(task, result.text) }
  } catch (err) {
    // A silent catch here is undiagnosable in production -- when a task
    // fails, this is the only record of why. Logged, not thrown: one
    // failed task must never take the other three down.
    console.error(`[analyzeContract] task "${task}" failed:`, err instanceof Error ? err.message : err)
    return { ok: false, data: null, ...mapTaskError(err) }
  }
}

export async function analyzeContract(contractId: string) {
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  const { data: version } = await supabase
    .from('contract_versions')
    .select('id')
    .eq('contract_id', contractId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!version) return { error: 'no_version' as const }

  const { data: clauseRows } = await supabase
    .from('clauses')
    .select('id, clause_number, body')
    .eq('version_id', version.id)
    .order('ordinal', { ascending: true })
  if (!clauseRows?.length) return { error: 'no_clauses' as const }

  const contentHash = sha256Hex(new TextEncoder().encode(clauseRows.map((c) => c.body).join('\n')))

  const { data: existing } = await supabase
    .from('analyses')
    .select('id, status, error')
    .eq('org_id', orgId)
    .eq('content_hash', contentHash)
    .maybeSingle()
  // A 'partial' analysis (some tasks failed) also has status 'ready' -- that
  // status alone can't gate the cache hit, or a Re-analyze click after a
  // provider outage becomes a permanent no-op: same content_hash forever
  // (the source PDF never changes), so it would keep short-circuiting to the
  // stale partial result with zero new AI calls, no matter how many times
  // the user clicks it. Confirmed live: a Re-analyze on a 'partial' analysis
  // returned in 148ms with no Gemini/OpenRouter calls in the server log at
  // all. Only a genuinely complete previous run should short-circuit.
  if (existing?.status === 'ready' && !existing.error) return { analysisId: existing.id as string, cached: true }

  const { data: analysis, error: analysisError } = existing
    ? await supabase.from('analyses').update({ status: 'pending', error: null }).eq('id', existing.id).select('id').single()
    : await supabase
        .from('analyses')
        .insert({ org_id: orgId, contract_id: contractId, version_id: version.id, content_hash: contentHash })
        .select('id')
        .single()
  if (analysisError || !analysis) return { error: 'unknown' as const }
  const analysisId = analysis.id as string

  const { data: ruleRows } = await supabase
    .from('playbook_rules')
    .select('rule_key, title, description, severity_hint')
  const rules: PlaybookRule[] = (ruleRows ?? []).map((r) => ({
    ruleKey: r.rule_key,
    title: r.title,
    description: r.description,
    severityHint: r.severity_hint,
  }))
  const clauses: PromptClause[] = clauseRows.map((c) => ({ id: c.id, clauseNumber: c.clause_number, body: c.body }))

  const logUsage = async (row: {
    task: string
    provider: string
    requestedModel: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  }) => {
    await supabase.from('usage_events').insert({
      org_id: orgId,
      contract_id: contractId,
      task: row.task,
      provider: row.provider,
      requested_model: row.requestedModel,
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cost_usd: row.costUsd,
    })
  }

  const [summaryRun, fieldsRun, risksRun, obligationsRun] = await Promise.all([
    runTask<SummaryOutput>('summary', 'main', summaryPrompt(clauses), logUsage),
    runTask<FieldsOutput>('fields', 'main', fieldsPrompt(clauses), logUsage),
    runTask<RisksOutput>('risks', 'main', risksPrompt(clauses, rules), logUsage),
    runTask<ObligationsOutput>('obligations', 'main', obligationsPrompt(clauses), logUsage),
  ])

  if (!summaryRun.ok && !fieldsRun.ok && !risksRun.ok && !obligationsRun.ok) {
    const errorCode = classifyAnalysisError([summaryRun, fieldsRun, risksRun, obligationsRun])
    await supabase.from('analyses').update({ status: 'failed', error: errorCode }).eq('id', analysisId)
    return { error: errorCode }
  }

  await supabase.from('risk_findings').delete().eq('analysis_id', analysisId)
  if (risksRun.ok && risksRun.data) {
    // Grounding is enforced here, not trusted from the prompt: a finding
    // survives only if it cites a real clause AND quotes words genuinely in
    // it. Asking the model for evidence makes a fabricated finding *possible*
    // to catch; this check is what actually catches it.
    const { kept, rejected } = verifyFindings(risksRun.data.findings, clauseRows.map((c) => ({ id: c.id, body: c.body })))

    // Logged, never silent: a run that drops most of its findings is the
    // signal that a prompt or model change has regressed, and without this
    // the only symptom is findings quietly going missing.
    if (rejected.length) {
      console.warn(
        `[analyzeContract] dropped ${rejected.length}/${risksRun.data.findings.length} ungrounded finding(s):`,
        rejected.map((r) => `${r.reason}: ${r.finding.title}`).join(' | '),
      )
    }

    if (kept.length) {
      await supabase.from('risk_findings').insert(
        kept.map((f) => ({
          analysis_id: analysisId,
          org_id: orgId,
          clause_id: f.clauseId,
          rule_key: f.ruleKey,
          severity: f.severity,
          title: f.title,
          reason: f.reason,
          reason_ar: f.reasonAr,
          evidence: f.evidence,
        })),
      )
    }
  }

  // Some (not all) tasks failing previously saved silently as a plain
  // 'ready' analysis -- the failed task's section just didn't appear, with
  // nothing telling the user or a future debugger that anything went wrong.
  // Status stays 'ready' (the tasks that DID succeed are real and worth
  // showing), but 'partial' on an otherwise-ready analysis is a visible,
  // non-blocking notice rather than a silently incomplete result.
  const allSucceeded = summaryRun.ok && fieldsRun.ok && risksRun.ok && obligationsRun.ok
  await supabase
    .from('analyses')
    .update({
      status: 'ready',
      error: allSucceeded ? null : 'partial',
      summary: summaryRun.ok ? summaryRun.data?.summary ?? null : null,
      fields: fieldsRun.ok ? fieldsRun.data : null,
      obligations: obligationsRun.ok ? obligationsRun.data?.obligations ?? null : null,
    })
    .eq('id', analysisId)

  revalidatePath(`/contracts/${contractId}`)
  return { analysisId, cached: false }
}
