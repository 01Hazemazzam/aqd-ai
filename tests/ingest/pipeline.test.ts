// tests/ingest/pipeline.test.ts
// @vitest-environment node
//
// Exercises the real document pipeline end to end against the local Supabase
// stack (Storage HTTP API + Postgres/RLS), the same way a browser upload
// would: sign up a user, create an org, request a signed upload URL, upload
// real file bytes, download them back, parse, segment, and store clauses.
// This is the integration risk that unit tests on parse.ts/segment.ts alone
// can't cover -- RLS on storage.objects, the bucket's mime/size limits, and
// the checksum-dedup path all only fail at this layer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from '@/lib/ingest/parse'
import { segmentClauses } from '@/lib/ingest/segment'
import { sha256Hex } from '@/lib/ingest/checksum'

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const EMAIL = 'pipeline-test@test.local'
const PASSWORD = 'PipelineTest123!'

let admin: Client
let userId: string
let orgId: string
let uploadedPath: string | null = null

async function fetchDocx() {
  return readFile(path.join(__dirname, '../fixtures/bilingual-contract.docx'))
}
async function fetchPdf() {
  return readFile(path.join(__dirname, '../fixtures/simple-contract.pdf'))
}

beforeAll(async () => {
  admin = new Client({ connectionString: DB_URL })
  await admin.connect()
  await admin.query(`delete from auth.users where email = $1`, [EMAIL])

  const supabase = createClient(SUPABASE_URL, ANON_KEY)
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email: EMAIL, password: PASSWORD })
  if (signUpError || !signUpData.user) throw new Error(`signup failed: ${signUpError?.message}`)
  userId = signUpData.user.id

  const { data: newOrgId, error: orgError } = await supabase.rpc('create_organization', { p_name: 'Pipeline Test Org' })
  if (orgError) throw new Error(`create_organization failed: ${orgError.message}`)
  orgId = newOrgId as string
})

afterAll(async () => {
  if (uploadedPath) {
    const supabase = createClient(SUPABASE_URL, ANON_KEY)
    await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    await supabase.storage.from('contracts').remove([uploadedPath])
  }
  await admin.query(`delete from auth.users where id = $1`, [userId])
  await admin.end()
})

describe('document pipeline (real Storage + Postgres)', () => {
  it('uploads a bilingual DOCX, parses it, and stores clauses with correct per-clause language', async () => {
    const supabase = createClient(SUPABASE_URL, ANON_KEY)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    expect(signInError).toBeNull()

    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .insert({ org_id: orgId, title: 'Bilingual Test Contract', created_by: userId })
      .select('id')
      .single()
    expect(contractError).toBeNull()

    const storagePath = `${orgId}/${contract!.id}/bilingual-contract.docx`
    uploadedPath = storagePath

    const { data: signed, error: signError } = await supabase.storage
      .from('contracts')
      .createSignedUploadUrl(storagePath)
    expect(signError).toBeNull()

    const fileBytes = await fetchDocx()
    const { error: uploadError } = await supabase.storage
      .from('contracts')
      .uploadToSignedUrl(
        storagePath,
        signed!.token,
        new Blob([new Uint8Array(fileBytes)], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      )
    expect(uploadError).toBeNull()

    const { data: downloaded, error: downloadError } = await supabase.storage.from('contracts').download(storagePath)
    expect(downloadError).toBeNull()
    const bytes = new Uint8Array(await downloaded!.arrayBuffer())
    expect(bytes.byteLength).toBe(fileBytes.byteLength)

    const checksum = sha256Hex(bytes)
    expect(checksum).toBe(sha256Hex(new Uint8Array(fileBytes)))

    const { data: file, error: fileError } = await supabase
      .from('contract_files')
      .insert({
        contract_id: contract!.id,
        org_id: orgId,
        storage_path: storagePath,
        filename: 'bilingual-contract.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: bytes.byteLength,
        checksum_sha256: checksum,
      })
      .select('id')
      .single()
    expect(fileError).toBeNull()

    const { data: version, error: versionError } = await supabase
      .from('contract_versions')
      .insert({ contract_id: contract!.id, org_id: orgId, file_id: file!.id, version_no: 1 })
      .select('id')
      .single()
    expect(versionError).toBeNull()

    const text = await parseDocument(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const clauses = segmentClauses(text)
    expect(clauses.map((c) => c.lang)).toEqual(['en', 'en', 'ar', 'ar'])
    expect(clauses.map((c) => c.clauseNumber)).toEqual(['1', '2', '3', '4'])

    const { error: clausesError } = await supabase.from('clauses').insert(
      clauses.map((c) => ({
        version_id: version!.id,
        org_id: orgId,
        ordinal: c.ordinal,
        clause_number: c.clauseNumber,
        lang: c.lang,
        body: c.body,
      })),
    )
    expect(clausesError).toBeNull()

    const { data: storedClauses, error: readError } = await supabase
      .from('clauses')
      .select('ordinal, lang, body, clause_number')
      .eq('version_id', version!.id)
      .order('ordinal', { ascending: true })
    expect(readError).toBeNull()
    expect(storedClauses).toHaveLength(4)
    expect(storedClauses!.map((c) => c.lang)).toEqual(['en', 'en', 'ar', 'ar'])
    expect(storedClauses![2].body).toContain('الإنهاء')
  })

  it('parses a PDF through the same pipeline', async () => {
    const bytes = new Uint8Array(await fetchPdf())
    const text = await parseDocument(bytes, 'application/pdf')
    const clauses = segmentClauses(text)
    expect(clauses.map((c) => c.clauseNumber)).toEqual(['1', '2'])
    expect(clauses.every((c) => c.lang === 'en')).toBe(true)
  })

  it('rejects a request for an org the caller does not belong to', async () => {
    const supabase = createClient(SUPABASE_URL, ANON_KEY)
    await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    const foreignOrgId = '00000000-0000-0000-0000-000000000000'
    const { error } = await supabase
      .from('contracts')
      .insert({ org_id: foreignOrgId, title: 'Should not be allowed', created_by: userId })
    expect(error).not.toBeNull()
  })
})
