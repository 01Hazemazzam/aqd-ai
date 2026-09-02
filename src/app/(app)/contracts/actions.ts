'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { parseDocument } from '@/lib/ingest/parse'
import { segmentClauses } from '@/lib/ingest/segment'
import { sha256Hex } from '@/lib/ingest/checksum'
import { embedTexts, toPgVector } from '@/lib/ai/embed'

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const MAX_SIZE_BYTES = 50 * 1024 * 1024

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-100)
}

export async function createUploadTarget(filename: string, mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return { error: 'unsupported_type' as const }
  if (sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) return { error: 'file_too_large' as const }

  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const title = filename.replace(/\.[^.]+$/, '').slice(0, 200) || filename
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .insert({ org_id: orgId, title, created_by: user.id })
    .select('id')
    .single()
  if (contractError || !contract) return { error: 'unknown' as const }

  const storagePath = `${orgId}/${contract.id}/${randomUUID()}-${sanitizeFilename(filename)}`
  const { data: signed, error: signError } = await supabase.storage
    .from('contracts')
    .createSignedUploadUrl(storagePath)
  if (signError || !signed) return { error: 'unknown' as const }

  return {
    contractId: contract.id as string,
    storagePath,
    token: signed.token,
  }
}

/**
 * A signed upload slot for a new version of a contract that already exists.
 *
 * Deliberately separate from `createUploadTarget` rather than a flag on it:
 * that one's job is to bring a contract into existence, and the revision path
 * must not create one -- a failed revision upload that left an empty second
 * contract behind would be worse than no revision support at all.
 */
export async function createRevisionTarget(
  contractId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return { error: 'unsupported_type' as const }
  if (sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) return { error: 'file_too_large' as const }

  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS would refuse the storage write anyway; reading the contract first
  // turns "the signed URL silently 403s later" into an error at the point the
  // user pressed the button.
  const { data: contract } = await supabase.from('contracts').select('id').eq('id', contractId).maybeSingle()
  if (!contract) return { error: 'not_found' as const }

  const storagePath = `${orgId}/${contractId}/${randomUUID()}-${sanitizeFilename(filename)}`
  const { data: signed, error: signError } = await supabase.storage
    .from('contracts')
    .createSignedUploadUrl(storagePath)
  if (signError || !signed) return { error: 'unknown' as const }

  return { contractId, storagePath, token: signed.token }
}

export async function ingestContract(
  contractId: string,
  storagePath: string,
  filename: string,
  mimeType: string,
) {
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  // Every version this contract already has, newest first. Two things come
  // from it: the number this parse run gets, and whether there is anything to
  // lose if it fails.
  const { data: existingVersions } = await supabase
    .from('contract_versions')
    .select('version_no, file_id')
    .eq('contract_id', contractId)
    .order('version_no', { ascending: false })
  const versionNo = (existingVersions?.[0]?.version_no ?? 0) + 1
  const isRevision = versionNo > 1

  // A first upload that fails leaves a contract with nothing in it, and the
  // reader needs to say why. A revision that fails must NOT mark the contract
  // failed: the version already in there is intact and still readable, and
  // burning it down because a second draft was corrupt would lose real work.
  const fail = async (error: 'download_failed' | 'parse_failed' | 'unknown') => {
    if (!isRevision) await supabase.from('contracts').update({ status: 'failed', error }).eq('id', contractId)
    return { error }
  }

  const { data: blob, error: downloadError } = await supabase.storage.from('contracts').download(storagePath)
  if (downloadError || !blob) return fail('download_failed')

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const checksum = sha256Hex(bytes)

  const { data: existingFile } = await supabase
    .from('contract_files')
    .select('id')
    .eq('org_id', orgId)
    .eq('checksum_sha256', checksum)
    .maybeSingle()

  // The same bytes are the same document. Storing them as a second version
  // would produce a comparison whose every clause is unchanged -- a page that
  // takes a minute to read and says nothing. Say it in one line instead.
  if (existingFile && existingVersions?.some((v) => v.file_id === existingFile.id)) {
    return { error: 'unchanged_file' as const }
  }

  // Parsing before any row is written. A document unpdf cannot read used to
  // leave a version row behind with no clauses under it, which the reader
  // renders as a contract that lost its text.
  let text: string
  try {
    text = await parseDocument(bytes, mimeType)
  } catch (err) {
    console.error('[ingestContract] parseDocument failed:', err instanceof Error ? err.message : err)
    return fail('parse_failed')
  }
  const clauses = segmentClauses(text)

  let fileId: string
  if (existingFile) {
    fileId = existingFile.id
  } else {
    const { data: newFile, error: fileError } = await supabase
      .from('contract_files')
      .insert({
        contract_id: contractId,
        org_id: orgId,
        storage_path: storagePath,
        filename,
        mime_type: mimeType,
        size_bytes: bytes.byteLength,
        checksum_sha256: checksum,
      })
      .select('id')
      .single()
    if (fileError || !newFile) return fail('unknown')
    fileId = newFile.id
  }

  const { data: version, error: versionError } = await supabase
    .from('contract_versions')
    .insert({ contract_id: contractId, org_id: orgId, file_id: fileId, version_no: versionNo })
    .select('id')
    .single()
  if (versionError || !version) return fail('unknown')

  const { data: insertedClauses, error: clausesError } = await supabase
    .from('clauses')
    .insert(
      clauses.map((clause) => ({
        version_id: version.id,
        org_id: orgId,
        ordinal: clause.ordinal,
        clause_number: clause.clauseNumber,
        lang: clause.lang,
        body: clause.body,
      })),
    )
    .select('id, body')
  if (clausesError || !insertedClauses) return fail('unknown')

  // Chat retrieval needs embeddings, but a document is fully usable (read,
  // analyze) without them -- so a failure here (no API key, rate limit)
  // logs and moves on rather than failing the whole ingest. Chat on this
  // contract will just find nothing to retrieve until it's re-embedded.
  try {
    const vectors = await embedTexts(insertedClauses.map((c) => c.body))
    await Promise.all(
      insertedClauses.map((clause, i) =>
        supabase.from('clauses').update({ embedding: toPgVector(vectors[i]) }).eq('id', clause.id),
      ),
    )
  } catch (err) {
    console.error(`[ingestContract] embedding failed for contract ${contractId}:`, err instanceof Error ? err.message : err)
  }

  await supabase.from('contracts').update({ status: 'ready', error: null }).eq('id', contractId)
  revalidatePath('/contracts')
  revalidatePath(`/contracts/${contractId}`)
  return { contractId, versionNo }
}
