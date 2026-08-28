-- bytea is awkward to filter on from PostgREST/supabase-js (the ingest action
-- queries this column directly for dedup, unlike code_hash/device_hash which
-- only ever go through security-definer SQL functions). Hex text is just as
-- good a dedup key and trivial to compare from JS.
alter table public.contract_files
  alter column checksum_sha256 type text using encode(checksum_sha256, 'hex');
