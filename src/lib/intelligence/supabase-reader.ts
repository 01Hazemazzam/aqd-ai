// The production adapter behind IntelligenceReader.
//
// Kept apart from load.ts so the shaping logic can be tested against an
// in-memory reader without dragging a Supabase client into the test. This
// file holds the column lists and nothing else; if it ever grows a rule,
// that rule belongs in load.ts where it can be tested.
//
// No org_id filter is a mistake waiting to happen here, so it is written
// explicitly even though RLS already scopes every one of these tables to
// jwt_org_id(). Belt and braces: the policy is the guarantee, the filter is
// the statement of intent.

import type { createServerSupabase } from '@/lib/supabase/server'
import type { AnalysisRow, ContractRow, FindingRow, IntelligenceReader } from './load'

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>

export function supabaseIntelligenceReader(supabase: Supabase): IntelligenceReader {
  return {
    async readyAnalyses(orgId) {
      const { data } = await supabase
        .from('analyses')
        .select('id, contract_id, obligations, obligation_parties, fields, schema_version, created_at')
        .eq('org_id', orgId)
        .eq('status', 'ready')
        // Newest first: loadIntelligence's latest-per-contract rule reads the
        // first sighting of a contract_id as the current analysis.
        .order('created_at', { ascending: false })
      return (data ?? []) as AnalysisRow[]
    },

    async contracts(orgId) {
      const { data } = await supabase.from('contracts').select('id, title').eq('org_id', orgId)
      return (data ?? []) as ContractRow[]
    },

    async findings(analysisIds) {
      if (analysisIds.length === 0) return []
      const { data } = await supabase
        .from('risk_findings')
        .select('id, analysis_id, clause_id, kind, severity, title, reason, reason_ar, rule_key')
        .in('analysis_id', analysisIds)
      return (data ?? []) as FindingRow[]
    },
  }
}
