-- An Analysis records which extraction schema produced it.
--
-- Analyses are cached by (org_id, content_hash) over a source document that
-- never changes, so an Analysis produced before the extractor started emitting
-- due specifications and party roles would NEVER re-run -- every existing
-- contract would sit permanently without deadlines, and nothing would say why.
--
-- The version therefore participates in the cache key: raising ANALYSIS_SCHEMA_VERSION
-- (src/lib/ai/schema-version.ts) makes every contract miss the cache once and
-- re-analyse on demand, and an Analysis whose version is behind is surfaced as
-- outdated rather than silently missing data.
--
-- Existing rows are stamped 0, which is below the first version that emits due
-- specifications -- so they read as outdated, which is exactly what they are.

alter table public.analyses
  add column schema_version int not null default 0;

create index analyses_schema_version_idx on public.analyses (schema_version);

-- The two parties the obligations extractor mapped party_a/party_b onto.
--
-- Deliberately separate from fields.parties, which a DIFFERENT task extracts
-- concurrently. Deriving the roles from fields.parties would either serialise
-- the two tasks (latency on every analysis) or trust that two independent
-- extractions ordered the same two names the same way -- and when they did
-- not, every obligation in the contract would be attributed to the wrong
-- party. Storing what the obligations task itself used keeps the roles and
-- the names it assigned them consistent by construction.
alter table public.analyses
  add column obligation_parties jsonb;
