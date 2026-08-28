'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { parseDocument } from '@/lib/ingest/parse'
import { segmentClauses } from '@/lib/ingest/segment'
import { sha256Hex } from '@/lib/ingest/checksum'

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

export async function ingestContract(
  contractId: string,
  storagePath: string,
  filename: string,
  mimeType: string,
) {
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  const fail = async (error: 'download_failed' | 'parse_failed' | 'unknown') => {
    await supabase.from('contracts').update({ status: 'failed', error }).eq('id', contractId)
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
    .insert({ contract_id: contractId, org_id: orgId, file_id: fileId, version_no: 1 })
    .select('id')
    .single()
  if (versionError || !version) return fail('unknown')

  let text: string
  try {
    text = await parseDocument(bytes, mimeType)
  } catch {
    return fail('parse_failed')
  }

  const clauses = segmentClauses(text)
  const { error: clausesError } = await supabase.from('clauses').insert(
    clauses.map((clause) => ({
      version_id: version.id,
      org_id: orgId,
      ordinal: clause.ordinal,
      clause_number: clause.clauseNumber,
      lang: clause.lang,
      body: clause.body,
    })),
  )
  if (clausesError) return fail('unknown')

  await supabase.from('contracts').update({ status: 'ready' }).eq('id', contractId)
  revalidatePath('/contracts')
  return { contractId }
}
