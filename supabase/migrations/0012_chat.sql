create extension if not exists vector;

-- 768 dims matches gemini-embedding-001's outputDimensionality param, chosen
-- to keep the app on Gemini end to end (embeddings + generation) rather than
-- standing up a separate embedding provider/edge function.
alter table public.clauses add column embedding vector(768);

create index clauses_embedding_hnsw_idx on public.clauses using hnsw (embedding vector_cosine_ops);

-- Plain SQL, not security definer: RLS on `clauses` (clauses_org_all) applies
-- under the caller's own privileges, the same tenancy guarantee every other
-- read in this app relies on -- no need to re-check org_id here.
create or replace function public.match_clauses(
  p_contract_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 6
)
returns table (
  id uuid,
  clause_number text,
  lang public.clause_lang,
  body text,
  ordinal int,
  similarity float
)
language sql
stable
as $$
  select c.id, c.clause_number, c.lang, c.body, c.ordinal, 1 - (c.embedding <=> p_query_embedding) as similarity
  from public.clauses c
  join public.contract_versions v on v.id = c.version_id
  where v.contract_id = p_contract_id
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;

create type public.chat_role as enum ('user', 'assistant');

-- One chat per contract for now -- the citation-locked Q&A the spec calls
-- for, not a multi-thread chat product. `unique(contract_id)` is the whole
-- MVP simplification.
create table public.chats (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (contract_id)
);

create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  role       public.chat_role not null,
  content    text not null,
  not_found  boolean not null default false,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

-- A citation always points to a real clause; a NOT_FOUND answer simply has
-- zero citation rows, not a citation with a null clause_id (unlike
-- risk_findings, where "missing clause" is itself the finding).
create table public.citations (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  clause_id  uuid not null references public.clauses(id) on delete cascade,
  ordinal    int not null,
  created_at timestamptz not null default now()
);

create index citations_message_idx on public.citations (message_id);

alter table public.chats         enable row level security;
alter table public.chat_messages enable row level security;
alter table public.citations     enable row level security;

create policy chats_org_all on public.chats
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy chat_messages_org_all on public.chat_messages
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy citations_org_all on public.citations
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());
