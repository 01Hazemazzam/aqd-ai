'use server'
import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { sha256Hex } from '@/lib/ingest/checksum'
import { aiComplete, type Tier } from '@/lib/ai/router'
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
}
type RisksOutput = { findings: RiskFinding[] }
type Obligation = { clauseId: string | null; obligor: string; action: string; due: string | null }
type ObligationsOutput = { obligations: Obligation[] }

interface TaskRun<T> {
  ok: boolean
  data: T | null
}

async function runTask<T>(
  task: string,
  tier: Tier,
  prompt: { system: string; user: string },
  logUsage: (row: { task: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }) => Promise<void>,
): Promise<TaskRun<T>> {
  try {
    const result = await aiComplete(tier, prompt.system, prompt.user)
    await logUsage({
      task,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    })
    return { ok: true, data: extractJson<T>(task, result.text) }
  } catch {
    return { ok: false, data: null }
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
    .select('id, status')
    .eq('org_id', orgId)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (existing?.status === 'ready') return { analysisId: existing.id as string, cached: true }

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

  const logUsage = async (row: { task: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }) => {
    await supabase.from('usage_events').insert({
      org_id: orgId,
      contract_id: contractId,
      task: row.task,
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
    const disabled = !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY
    await supabase
      .from('analyses')
      .update({ status: 'failed', error: disabled ? 'ai_disabled' : 'unknown' })
      .eq('id', analysisId)
    return { error: disabled ? ('ai_disabled' as const) : ('unknown' as const) }
  }

  const validClauseIds = new Set(clauseRows.map((c) => c.id))

  await supabase.from('risk_findings').delete().eq('analysis_id', analysisId)
  if (risksRun.ok && risksRun.data) {
    const findings = risksRun.data.findings.filter((f) => f.clauseId === null || validClauseIds.has(f.clauseId))
    if (findings.length) {
      await supabase.from('risk_findings').insert(
        findings.map((f) => ({
          analysis_id: analysisId,
          org_id: orgId,
          clause_id: f.clauseId,
          rule_key: f.ruleKey,
          severity: f.severity,
          title: f.title,
          reason: f.reason,
          reason_ar: f.reasonAr,
        })),
      )
    }
  }

  await supabase
    .from('analyses')
    .update({
      status: 'ready',
      error: null,
      summary: summaryRun.ok ? summaryRun.data?.summary ?? null : null,
      fields: fieldsRun.ok ? fieldsRun.data : null,
      obligations: obligationsRun.ok ? obligationsRun.data?.obligations ?? null : null,
    })
    .eq('id', analysisId)

  revalidatePath(`/contracts/${contractId}`)
  return { analysisId, cached: false }
}
