create type public.risk_severity as enum ('high', 'medium', 'low');
create type public.analysis_status as enum ('pending', 'ready', 'failed');

-- Global legal playbook: shared read-only content, not tenant data, so it
-- carries no org_id and its RLS policy is "any authenticated user" rather
-- than the jwt_org_id() pattern every tenant table uses.
create table public.playbooks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table public.playbook_rules (
  id            uuid primary key default gen_random_uuid(),
  playbook_id   uuid not null references public.playbooks(id) on delete cascade,
  rule_key      text not null,
  title         text not null,
  description   text not null,
  severity_hint public.risk_severity not null default 'medium',
  created_at    timestamptz not null default now(),
  unique (playbook_id, rule_key)
);

-- Cached by (org_id, content_hash) -- content_hash is a hash of the version's
-- clause bodies concatenated, so re-analyzing an unchanged document is a
-- cache hit instead of a re-spend. summary/fields/obligations are small,
-- single-shot JSON blobs with no independent query need, so they live as
-- columns here rather than their own tables; risk_findings gets its own
-- table below because the reader needs to join findings onto clauses.
create table public.analyses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  version_id   uuid not null references public.contract_versions(id) on delete cascade,
  content_hash text not null,
  status       public.analysis_status not null default 'pending',
  summary      text,
  fields       jsonb,
  obligations  jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, content_hash)
);

create index analyses_contract_idx on public.analyses (contract_id, created_at desc);

-- clause_id is nullable: a finding for a REQUIRED clause the document never
-- includes (e.g. "no termination clause") has nothing to point at.
create table public.risk_findings (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  clause_id   uuid references public.clauses(id) on delete set null,
  rule_key    text,
  severity    public.risk_severity not null,
  title       text not null,
  reason      text not null,
  reason_ar   text,
  created_at  timestamptz not null default now()
);

create index risk_findings_analysis_idx on public.risk_findings (analysis_id);
create index risk_findings_clause_idx on public.risk_findings (clause_id);

-- Deliberately NOT cascaded from contracts: cost/usage history should
-- survive a contract's deletion, so contract_id is set null instead.
create table public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contract_id   uuid references public.contracts(id) on delete set null,
  task          text not null,
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_usd      numeric(10, 6) not null default 0,
  created_at    timestamptz not null default now()
);

create index usage_events_org_idx on public.usage_events (org_id, created_at desc);

alter table public.playbooks      enable row level security;
alter table public.playbook_rules enable row level security;
alter table public.analyses       enable row level security;
alter table public.risk_findings  enable row level security;
alter table public.usage_events   enable row level security;

create policy playbooks_read_all on public.playbooks
  for select using (auth.role() = 'authenticated');

create policy playbook_rules_read_all on public.playbook_rules
  for select using (auth.role() = 'authenticated');

create policy analyses_org_all on public.analyses
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy risk_findings_org_all on public.risk_findings
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create policy usage_events_org_all on public.usage_events
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

create trigger analyses_set_updated_at
  before update on public.analyses
  for each row execute function public.set_updated_at();

insert into public.playbooks (id, name, description) values
  ('00000000-0000-0000-0000-000000000001', 'Default Commercial Playbook', 'A general-purpose rulebook for commercial contracts, checked against every clause during analysis.');

insert into public.playbook_rules (playbook_id, rule_key, title, description, severity_hint) values
  ('00000000-0000-0000-0000-000000000001', 'termination_clause', 'Termination rights', 'The contract should state how and when either party may terminate.', 'high'),
  ('00000000-0000-0000-0000-000000000001', 'unlimited_liability', 'Unlimited liability', 'Liability should be capped; an unlimited or one-sided liability clause is a high-severity risk.', 'high'),
  ('00000000-0000-0000-0000-000000000001', 'auto_renewal_notice', 'Auto-renewal without notice', 'An auto-renewal clause without a clear opt-out notice period traps a party into an unwanted term.', 'medium'),
  ('00000000-0000-0000-0000-000000000001', 'unilateral_amendment', 'Unilateral amendment rights', 'One party being able to amend the contract without the other''s consent is a fairness risk.', 'medium'),
  ('00000000-0000-0000-0000-000000000001', 'governing_law', 'Governing law', 'The contract should name a governing law and jurisdiction for disputes.', 'medium'),
  ('00000000-0000-0000-0000-000000000001', 'confidentiality', 'Confidentiality obligations', 'Commercial contracts exchanging sensitive information should include confidentiality obligations.', 'low'),
  ('00000000-0000-0000-0000-000000000001', 'indemnification_balance', 'Indemnification imbalance', 'A one-sided indemnification clause that only protects one party is a fairness risk.', 'medium'),
  ('00000000-0000-0000-0000-000000000001', 'dispute_resolution', 'Dispute resolution mechanism', 'The contract should specify how disputes are resolved (courts, arbitration, mediation).', 'low');
