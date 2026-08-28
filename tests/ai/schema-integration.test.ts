// tests/ai/schema-integration.test.ts
// @vitest-environment node
//
// Proves the analysis schema's RLS against the real local Postgres, the same
// way tests/ingest/pipeline.test.ts proved the document pipeline's. The
// server action itself isn't imported here -- it depends on Next's
// request-scoped cookies(), which doesn't exist under Vitest -- so this
// exercises the same operations analyzeContract() performs, directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { aiComplete, AiDisabledError } from '@/lib/ai/router'

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const EMAIL_A = 'analysis-test-a@test.local'
const EMAIL_B = 'analysis-test-b@test.local'
const PASSWORD = 'AnalysisTest123!'

let admin: Client
let userA: string, userB: string
let orgA: string, orgB: string
let contractA: string, versionA: string, clauseA: string

async function signedInClient(email: string) {
  const supabase = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  expect(error).toBeNull()
  return supabase
}

beforeAll(async () => {
  admin = new Client({ connectionString: DB_URL })
  await admin.connect()
  await admin.query(`delete from auth.users where email = any($1)`, [[EMAIL_A, EMAIL_B]])

  const a = createClient(SUPABASE_URL, ANON_KEY)
  const { data: signUpA } = await a.auth.signUp({ email: EMAIL_A, password: PASSWORD })
  userA = signUpA!.user!.id
  const { data: orgIdA } = await a.rpc('create_organization', { p_name: 'Analysis Test Org A' })
  orgA = orgIdA as string

  const b = createClient(SUPABASE_URL, ANON_KEY)
  const { data: signUpB } = await b.auth.signUp({ email: EMAIL_B, password: PASSWORD })
  userB = signUpB!.user!.id
  const { data: orgIdB } = await b.rpc('create_organization', { p_name: 'Analysis Test Org B' })
  orgB = orgIdB as string

  const { data: contract } = await a
    .from('contracts')
    .insert({ org_id: orgA, title: 'Analysis Test Contract', created_by: userA })
    .select('id')
    .single()
  contractA = contract!.id

  const { data: file } = await a
    .from('contract_files')
    .insert({
      contract_id: contractA,
      org_id: orgA,
      storage_path: `${orgA}/${contractA}/fake.pdf`,
      filename: 'fake.pdf',
      mime_type: 'application/pdf',
      size_bytes: 10,
      checksum_sha256: 'abc123',
    })
    .select('id')
    .single()

  const { data: version } = await a
    .from('contract_versions')
    .insert({ contract_id: contractA, org_id: orgA, file_id: file!.id, version_no: 1 })
    .select('id')
    .single()
  versionA = version!.id

  const { data: clause } = await a
    .from('clauses')
    .insert({ version_id: versionA, org_id: orgA, ordinal: 1, clause_number: '1', lang: 'en', body: 'Test clause body.' })
    .select('id')
    .single()
  clauseA = clause!.id
})

afterAll(async () => {
  await admin.query(`delete from auth.users where id = any($1)`, [[userA, userB]])
  await admin.end()
})

describe('playbook (global, read-only content)', () => {
  it('is readable by any authenticated user and carries the seeded rules', async () => {
    const a = await signedInClient(EMAIL_A)
    const { data, error } = await a.from('playbook_rules').select('rule_key, severity_hint')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.map((r) => r.rule_key)).toContain('termination_clause')
  })
})

describe('analyses / risk_findings / usage_events RLS', () => {
  it('lets an org member create and read back an analysis for their own contract', async () => {
    const a = await signedInClient(EMAIL_A)
    const { data: analysis, error } = await a
      .from('analyses')
      .insert({
        org_id: orgA,
        contract_id: contractA,
        version_id: versionA,
        content_hash: 'deadbeef',
        status: 'ready',
        summary: 'A test summary.',
        fields: { parties: ['Acme', 'Widgets Co'], effectiveDate: null, termLength: null, governingLaw: null, totalValue: null },
        obligations: [{ clauseId: clauseA, obligor: 'Acme', action: 'Deliver widgets', due: null }],
      })
      .select('id')
      .single()
    expect(error).toBeNull()

    const { data: finding, error: findingError } = await a
      .from('risk_findings')
      .insert({
        analysis_id: analysis!.id,
        org_id: orgA,
        clause_id: clauseA,
        rule_key: 'termination_clause',
        severity: 'high',
        title: 'Missing termination clause',
        reason: 'The contract never states how it can be terminated.',
        reason_ar: 'لا تنص الاتفاقية على كيفية إنهائها.',
      })
      .select('id')
      .single()
    expect(findingError).toBeNull()

    const { data: readBack } = await a.from('analyses').select('summary, fields').eq('id', analysis!.id).single()
    expect(readBack?.summary).toBe('A test summary.')
    expect((readBack?.fields as { parties: string[] }).parties).toEqual(['Acme', 'Widgets Co'])

    const { data: findingReadBack } = await a
      .from('risk_findings')
      .select('severity, title')
      .eq('id', finding!.id)
      .single()
    expect(findingReadBack?.severity).toBe('high')

    await a.from('usage_events').insert({
      org_id: orgA,
      contract_id: contractA,
      task: 'summary',
      model: 'test-model',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    const { data: usage } = await a.from('usage_events').select('task').eq('contract_id', contractA)
    expect(usage).toHaveLength(1)
  })

  it('hides org A\'s analyses, findings, and usage events from org B', async () => {
    const b = await signedInClient(EMAIL_B)
    const { data: analyses } = await b.from('analyses').select('id').eq('contract_id', contractA)
    expect(analyses).toHaveLength(0)

    const { data: usage } = await b.from('usage_events').select('id').eq('contract_id', contractA)
    expect(usage).toHaveLength(0)

    const { error } = await b
      .from('analyses')
      .insert({ org_id: orgA, contract_id: contractA, version_id: versionA, content_hash: 'hijack' })
    expect(error).not.toBeNull()
  })
})

describe('aiComplete in the current (keyless) deployment state', () => {
  it('throws AiDisabledError rather than making a network call', async () => {
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    const originalGemini = process.env.GEMINI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      await expect(aiComplete('main', 'sys', 'user')).rejects.toBeInstanceOf(AiDisabledError)
    } finally {
      if (originalAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropic
      if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini
    }
  })
})
