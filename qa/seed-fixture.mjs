// qa/seed-fixture.mjs
//
// Seeds one qa/fixtures/*.json contract (real clause text, no AI call) into
// the local dev database so its real analysis can be re-run through the
// actual UI/production path. Doesn't call any AI provider itself -- this is
// the "make the fixture real data" half of repeatability; running Analyze
// in the browser (or calling analyzeContract) is the half that spends quota.
//
// Usage: node qa/seed-fixture.mjs <fixture-file> <org-id> <user-id>
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const [, , fixturePath, orgId, userId] = process.argv
if (!fixturePath || !orgId || !userId) {
  console.error('Usage: node qa/seed-fixture.mjs <fixture-file> <org-id> <user-id>')
  process.exit(1)
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
})
await client.connect()

const contract = await client.query(
  `insert into public.contracts (org_id, title, status, created_by) values ($1, $2, 'ready', $3) returning id`,
  [orgId, fixture.title, userId],
)
const contractId = contract.rows[0].id

const file = await client.query(
  `insert into public.contract_files (contract_id, org_id, storage_path, filename, mime_type, size_bytes, checksum_sha256)
   values ($1, $2, $3, $4, 'application/pdf', 1, $5) returning id`,
  [contractId, orgId, `qa/${contractId}.pdf`, `${fixture.title}.pdf`, `qa-${contractId}`],
)

const version = await client.query(
  `insert into public.contract_versions (contract_id, org_id, file_id, version_no) values ($1, $2, $3, 1) returning id`,
  [contractId, orgId, file.rows[0].id],
)
const versionId = version.rows[0].id

for (let i = 0; i < fixture.clauses.length; i++) {
  const clause = fixture.clauses[i]
  await client.query(
    `insert into public.clauses (version_id, org_id, ordinal, clause_number, lang, body) values ($1, $2, $3, $4, $5, $6)`,
    [versionId, orgId, i + 1, clause.number, clause.lang, clause.body],
  )
}

console.log(`Seeded "${fixture.title}" -> contract ${contractId} (${fixture.clauses.length} clauses)`)
console.log(`Open http://localhost:3002/contracts/${contractId} and click Analyze to run the real pipeline.`)
await client.end()
