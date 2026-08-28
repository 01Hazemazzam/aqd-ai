create extension if not exists pg_trgm;

create type public.contract_status as enum ('uploaded', 'parsing', 'ready', 'failed');
create type public.clause_lang as enum ('ar', 'en');

create table public.contracts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  title      text not null check (length(trim(title)) between 1 and 200),
  status     public.contract_status not null default 'uploaded',
  error      text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_org_idx on public.contracts (org_id, created_at desc);

-- One row per uploaded file. checksum_sha256 lets a re-upload of the exact
-- same bytes short-circuit parsing instead of re-ingesting for free.
create table public.contract_files (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  storage_path    text not null unique,
  filename        text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  checksum_sha256 bytea not null,
  created_at      timestamptz not null default now(),
  unique (org_id, checksum_sha256)
);

create index contract_files_contract_idx on public.contract_files (contract_id);

-- A contract can be re-uploaded (a revised draft); each parse run gets its
-- own version so clauses always trace back to the exact file they came from.
create table public.contract_versions (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  file_id     uuid not null references public.contract_files(id) on delete cascade,
  version_no  int not null,
  created_at  timestamptz not null default now(),
  unique (contract_id, version_no)
);

create table public.clauses (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.contract_versions(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  ordinal       int not null,
  clause_number text,
  lang          public.clause_lang not null,
  body          text not null,
  created_at    timestamptz not null default now(),
  unique (version_id, ordinal)
);

create index clauses_version_idx on public.clauses (version_id, ordinal);
create index clauses_body_trgm_idx on public.clauses using gin (body gin_trgm_ops);

alter table public.contracts         enable row level security;
alter table public.contract_files    enable row level security;
alter table public.contract_versions enable row level security;
alter table public.clauses           enable row level security;

create policy contracts_org_all on public.contracts
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy contract_files_org_all on public.contract_files
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy contract_versions_org_all on public.contract_versions
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy clauses_org_all on public.clauses
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();
