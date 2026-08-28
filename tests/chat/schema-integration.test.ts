// tests/chat/schema-integration.test.ts
// @vitest-environment node
//
// Proves the chat schema's RLS and match_clauses() against real local
// Postgres, same pattern as tests/ai/schema-integration.test.ts. The
// embedding calls here are real (not mocked) specifically to prove
// match_clauses actually ranks by semantic similarity, not just that the
// RPC executes -- that's a correctness claim a pure-RLS test can't make.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { embedTexts, toPgVector } from '@/lib/ai/embed'

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const EMAIL_A = 'chat-test-a@test.local'
const EMAIL_B = 'chat-test-b@test.local'
const PASSWORD = 'ChatTest123!'
const hasKey = !!process.env.GEMINI_API_KEY

let admin: Client
let userA: string, userB: string
let orgA: string, orgB: string
let contractA: string, versionA: string
let clauseTermination: string, clauseConfidentiality: string

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
  const { data: orgIdA } = await a.rpc('create_organization', { p_name: 'Chat Test Org A' })
  orgA = orgIdA as string

  const b = createClient(SUPABASE_URL, ANON_KEY)
  const { data: signUpB } = await b.auth.signUp({ email: EMAIL_B, password: PASSWORD })
  userB = signUpB!.user!.id
  const { data: orgIdB } = await b.rpc('create_organization', { p_name: 'Chat Test Org B' })
  orgB = orgIdB as string

  const { data: contract } = await a
    .from('contracts')
    .insert({ org_id: orgA, title: 'Chat Test Contract', created_by: userA })
    .select('id')
    .single()
  contractA = contract!.id

  const { data: file } = await a
    .from('contract_files')
    .insert({
      contract_id: contractA, org_id: orgA, storage_path: `${orgA}/${contractA}/fake.pdf`,
      filename: 'fake.pdf', mime_type: 'application/pdf', size_bytes: 10, checksum_sha256: 'chatabc',
    })
    .select('id')
    .single()

  const { data: version } = await a
    .from('contract_versions')
    .insert({ contract_id: contractA, org_id: orgA, file_id: file!.id, version_no: 1 })
    .select('id')
    .single()
  versionA = version!.id

  const bodies = [
    'Termination. Either party may terminate this Agreement upon thirty days written notice.',
    'Confidentiality. Each party shall keep the other party\'s confidential information secret.',
  ]
  const { data: clauses } = await a
    .from('clauses')
    .insert(
      bodies.map((body, i) => ({ version_id: versionA, org_id: orgA, ordinal: i + 1, clause_number: String(i + 1), lang: 'en', body })),
    )
    .select('id, body')
  clauseTermination = clauses!.find((c) => c.body.startsWith('Termination'))!.id
  clauseConfidentiality = clauses!.find((c) => c.body.startsWith('Confidentiality'))!.id

  if (hasKey) {
    const vectors = await embedTexts(bodies)
    await Promise.all(
      clauses!.map((c, i) => a.from('clauses').update({ embedding: toPgVector(vectors[i]) }).eq('id', c.id)),
    )
  }
})

afterAll(async () => {
  await admin.query(`delete from auth.users where id = any($1)`, [[userA, userB]])
  await admin.end()
})

describe.skipIf(!hasKey)('match_clauses (real embeddings)', () => {
  it('ranks the semantically relevant clause first for a real question', async () => {
    const a = await signedInClient(EMAIL_A)
    const [queryVector] = await embedTexts(['How can this contract be ended?'])
    const { data: matches, error } = await a.rpc('match_clauses', {
      p_contract_id: contractA,
      p_query_embedding: toPgVector(queryVector),
      p_match_count: 2,
    })
    expect(error).toBeNull()
    expect(matches?.[0]?.id).toBe(clauseTermination)
    expect(matches?.[0]?.similarity).toBeGreaterThan(matches?.[1]?.similarity ?? 0)
  })

  it('is org-scoped: a different org gets no matches for the same contract id', async () => {
    const b = await signedInClient(EMAIL_B)
    const [queryVector] = await embedTexts(['test'])
    const { data: matches } = await b.rpc('match_clauses', {
      p_contract_id: contractA,
      p_query_embedding: toPgVector(queryVector),
      p_match_count: 5,
    })
    expect(matches).toHaveLength(0)
  })
})

describe('chats / chat_messages / citations RLS', () => {
  it('lets an org member create a chat, post messages, and cite a clause', async () => {
    const a = await signedInClient(EMAIL_A)
    const { data: chat, error: chatError } = await a
      .from('chats')
      .insert({ org_id: orgA, contract_id: contractA })
      .select('id')
      .single()
    expect(chatError).toBeNull()

    const { error: userMsgError } = await a
      .from('chat_messages')
      .insert({ chat_id: chat!.id, org_id: orgA, role: 'user', content: 'How can this be terminated?' })
    expect(userMsgError).toBeNull()

    const { data: assistantMsg, error: assistantMsgError } = await a
      .from('chat_messages')
      .insert({ chat_id: chat!.id, org_id: orgA, role: 'assistant', content: 'With 30 days notice [1].' })
      .select('id')
      .single()
    expect(assistantMsgError).toBeNull()

    const { error: citationError } = await a
      .from('citations')
      .insert({ message_id: assistantMsg!.id, org_id: orgA, clause_id: clauseTermination, ordinal: 1 })
    expect(citationError).toBeNull()

    const { data: readBack } = await a
      .from('chat_messages')
      .select('role, content')
      .eq('chat_id', chat!.id)
      .order('created_at')
    expect(readBack).toHaveLength(2)
    expect(readBack![0].role).toBe('user')
    expect(readBack![1].role).toBe('assistant')
  })

  it('enforces one chat per contract', async () => {
    const a = await signedInClient(EMAIL_A)
    const { error } = await a.from('chats').insert({ org_id: orgA, contract_id: contractA })
    expect(error).not.toBeNull()
  })

  it('hides org A\'s chat and messages from org B', async () => {
    const b = await signedInClient(EMAIL_B)
    const { data: chats } = await b.from('chats').select('id').eq('contract_id', contractA)
    expect(chats).toHaveLength(0)

    const { error } = await b.from('chats').insert({ org_id: orgA, contract_id: contractA })
    expect(error).not.toBeNull()
  })
})
