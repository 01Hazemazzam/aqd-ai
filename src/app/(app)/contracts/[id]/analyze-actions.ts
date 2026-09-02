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
  crossClausePrompt,
  obligationsPrompt,
  extractJson,
  type PromptClause,
  type PlaybookRule,
} from '@/lib/ai/prompts'
import type { RawFinding } from '@/lib/ai/verify-findings'
import { dropRedundantRelational } from '@/lib/ai/dedupe-findings'
import { verifyObligations, type RawObligation as RawObligationInput } from '@/lib/ai/verify-obligations'
import { ANALYSIS_SCHEMA_VERSION, isCurrentSchema } from '@/lib/ai/schema-version'

type SummaryOutput = { summary: string }
type FieldsOutput = {
  parties: string[] | null
  effectiveDate: string | null
  termLength: string | null
  governingLaw: string | null
  totalValue: string | null
}
// Both risk passes emit the same finding shape and are verified by the same
// code, so they share one type -- deliberately the verifier's own RawFinding
// (untrusted, every field optional-ish) rather than a tidier local type that
// would imply the model's output can be relied on.
type RisksOutput = { findings: RawFinding[] }
// The obligations task names the parties it mapped roles onto -- see
// obligationsPrompt for why it does that rather than reusing the fields task's
// list.
type ObligationsOutput = { parties?: string[]; obligations: RawObligationInput[] }

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
    .select('id, status, error, schema_version')
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
  //
  // The schema version joins that gate for the same reason: the document is
  // unchanged, so content_hash alone would keep serving an analysis produced
  // before the extractor emitted due specifications -- permanently, for every
  // contract analysed before the change. A cached result is only a hit if it
  // was produced by the extraction schema currently in force.
  if (existing?.status === 'ready' && !existing.error && isCurrentSchema(existing.schema_version as number | null)) {
    return { analysisId: existing.id as string, cached: true }
  }

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

  // Five tasks, still one round trip's worth of wall time. The cross-clause
  // pass is a separate call rather than more instructions bolted onto the
  // risks prompt because the two ask for opposite reading habits: the
  // playbook pass checks each clause against a fixed list, the cross-clause
  // pass ignores the list and reads for relationships. Merged into one
  // prompt the checklist dominates and the relational findings stop
  // appearing.
  const [summaryRun, fieldsRun, risksRun, crossRun, obligationsRun] = await Promise.all([
    runTask<SummaryOutput>('summary', 'main', summaryPrompt(clauses), logUsage),
    runTask<FieldsOutput>('fields', 'main', fieldsPrompt(clauses), logUsage),
    runTask<RisksOutput>('risks', 'main', risksPrompt(clauses, rules), logUsage),
    runTask<RisksOutput>('cross_clause', 'main', crossClausePrompt(clauses), logUsage),
    runTask<ObligationsOutput>('obligations', 'main', obligationsPrompt(clauses), logUsage),
  ])

  if (!summaryRun.ok && !fieldsRun.ok && !risksRun.ok && !crossRun.ok && !obligationsRun.ok) {
    const errorCode = classifyAnalysisError([summaryRun, fieldsRun, risksRun, crossRun, obligationsRun])
    await supabase.from('analyses').update({ status: 'failed', error: errorCode }).eq('id', analysisId)
    return { error: errorCode }
  }

  // finding_evidence cascades from risk_findings, so this clears both.
  await supabase.from('risk_findings').delete().eq('analysis_id', analysisId)

  // Both passes' findings go through the same verifier and the same table --
  // the reader sees one list of risks, not "playbook risks" and "structural
  // risks" as separate features. `kind` is what distinguishes them.
  const proposed: RawFinding[] = [
    ...(risksRun.ok ? (risksRun.data?.findings ?? []).map((f) => ({ ...f, kind: 'playbook' })) : []),
    ...(crossRun.ok ? (crossRun.data?.findings ?? []) : []),
  ]

  if (proposed.length) {
    // Grounding is enforced here, not trusted from the prompt: a finding
    // survives only if every clause it cites is real AND every quote it gives
    // is genuinely in that clause. Asking the model for evidence makes a
    // fabricated finding *possible* to catch; this check is what actually
    // catches it.
    const verified = verifyFindings(proposed, clauseRows.map((c) => ({ id: c.id, body: c.body })))
    const rejected = verified.rejected

    // Grounded is not the same as worth showing. On a badly one-sided
    // contract both passes converge on the same clauses, and the reader ends
    // up with two rows per risk; this drops the relational findings that add
    // no clause the playbook pass had not already reported.
    const { kept, dropped } = dropRedundantRelational(verified.kept)
    if (dropped.length) {
      console.info(
        `[analyzeContract] dropped ${dropped.length} cross-clause finding(s) already covered by the playbook pass:`,
        dropped.map((d) => d.title).join(' | '),
      )
    }

    // Logged, never silent: a run that drops most of its findings is the
    // signal that a prompt or model change has regressed, and without this
    // the only symptom is findings quietly going missing.
    if (rejected.length) {
      console.warn(
        `[analyzeContract] dropped ${rejected.length}/${proposed.length} ungrounded finding(s):`,
        rejected.map((r) => `${r.reason}: ${r.finding.title}`).join(' | '),
      )
    }

    if (kept.length) {
      // Ids are generated here rather than read back from the insert, so
      // linking a finding to its quotes never depends on the order rows come
      // back in. A mismatch there would silently attach one finding's
      // evidence to another -- the exact failure this whole module exists to
      // prevent, arriving through the back door.
      const rows = kept.map((f) => ({ id: crypto.randomUUID(), finding: f }))

      const { error: insertError } = await supabase.from('risk_findings').insert(
        rows.map(({ id, finding }) => ({
          id,
          analysis_id: analysisId,
          org_id: orgId,
          clause_id: finding.clauseId,
          rule_key: finding.ruleKey,
          kind: finding.kind,
          severity: finding.severity,
          title: finding.title,
          reason: finding.reason,
          reason_ar: finding.reasonAr,
        })),
      )

      if (!insertError) {
        const spans = rows.flatMap(({ id, finding }) =>
          finding.evidence.map((span, ordinal) => ({
            finding_id: id,
            org_id: orgId,
            clause_id: span.clauseId,
            quote: span.quote,
            ordinal,
          })),
        )
        if (spans.length) await supabase.from('finding_evidence').insert(spans)
      }
    }
  }

  // Obligations get the same treatment as findings: the model proposes the
  // timing structure, code checks it against the clause. A specification that
  // does not check out costs the obligation its date, never the obligation
  // itself -- an obligation with no deadline is a true statement about what
  // the document supports; a wrong deadline on a legal calendar is not.
  const { obligations: verifiedObligations, droppedSpecs } = obligationsRun.ok
    ? verifyObligations(
        obligationsRun.data?.obligations ?? [],
        clauseRows.map((c) => ({ id: c.id, body: c.body })),
      )
    : { obligations: [], droppedSpecs: [] }

  if (droppedSpecs.length) {
    console.warn(
      `[analyzeContract] dropped ${droppedSpecs.length} ungrounded due specification(s):`,
      droppedSpecs.map((d) => `${d.reason}: ${d.action}`).join(' | '),
    )
  }

  const rawParties = obligationsRun.ok ? obligationsRun.data?.parties : null
  const obligationParties = Array.isArray(rawParties)
    ? rawParties.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 2)
    : null

  // Some (not all) tasks failing previously saved silently as a plain
  // 'ready' analysis -- the failed task's section just didn't appear, with
  // nothing telling the user or a future debugger that anything went wrong.
  // Status stays 'ready' (the tasks that DID succeed are real and worth
  // showing), but 'partial' on an otherwise-ready analysis is a visible,
  // non-blocking notice rather than a silently incomplete result.
  const allSucceeded = summaryRun.ok && fieldsRun.ok && risksRun.ok && crossRun.ok && obligationsRun.ok
  await supabase
    .from('analyses')
    .update({
      status: 'ready',
      error: allSucceeded ? null : 'partial',
      summary: summaryRun.ok ? summaryRun.data?.summary ?? null : null,
      fields: fieldsRun.ok ? fieldsRun.data : null,
      obligations: obligationsRun.ok ? verifiedObligations : null,
      obligation_parties: obligationsRun.ok ? obligationParties : null,
      // Stamped only on a run that actually produced this schema's output. A
      // failed obligations task must not mark the analysis current, or the
      // contract would never re-run and would sit without deadlines forever.
      schema_version: obligationsRun.ok ? ANALYSIS_SCHEMA_VERSION : 0,
    })
    .eq('id', analysisId)

  revalidatePath(`/contracts/${contractId}`)
  return { analysisId, cached: false }
}
