-- Evidence becomes a list of spans, not a single quote.
--
-- 0016 gave a finding one verbatim quote from the one clause it cited. That
-- is enough for a playbook finding ("this clause says liability is
-- unlimited") and structurally too small for the findings this migration
-- exists to enable: an asymmetry, a contradiction, or a dependency is a
-- claim ABOUT THE RELATIONSHIP between two clauses, and it can only be shown
-- by quoting both. "Customer may terminate for convenience" is not evidence
-- of one-sidedness on its own -- it becomes evidence only next to the clause
-- that gives the provider no equivalent right.
--
-- So evidence moves out of the column and into its own table, one row per
-- quoted clause. A single-clause finding is simply a finding with one span,
-- which is why the column can go rather than stay alongside.
--
-- risk_findings.clause_id survives as the finding's PRIMARY anchor (the
-- clause the reader's severity gutter marks); it is the clause of the first
-- span. The spans carry the citations.

create table public.finding_evidence (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.risk_findings(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  clause_id  uuid not null references public.clauses(id) on delete cascade,
  -- Verbatim excerpt, verified in code against clause_id's body before it is
  -- ever inserted (src/lib/ai/verify-findings.ts).
  quote      text not null,
  ordinal    int  not null default 0
);

create index finding_evidence_finding_idx on public.finding_evidence (finding_id, ordinal);
create index finding_evidence_clause_idx on public.finding_evidence (clause_id);

alter table public.finding_evidence enable row level security;

create policy finding_evidence_org_all on public.finding_evidence
  for all using (org_id = public.jwt_org_id())
  with check (org_id = public.jwt_org_id());

-- Carry over what 0016's column holds, then drop it so evidence has exactly
-- one home. Findings analysed before 0016 have no quote and simply get no
-- span, which is the same "no evidence captured" state the reader already
-- falls back on.
insert into public.finding_evidence (finding_id, org_id, clause_id, quote, ordinal)
select f.id, f.org_id, f.clause_id, f.evidence, 0
from public.risk_findings f
where f.evidence is not null and f.clause_id is not null;

alter table public.risk_findings drop column evidence;

-- A finding's kind: what sort of reasoning produced it. 'playbook' is the
-- rule-checklist pass that already existed; the rest come from the
-- cross-clause pass, which finds what a presence/absence checklist
-- structurally cannot see.
create type public.finding_kind as enum ('playbook', 'asymmetry', 'contradiction', 'dependency');

alter table public.risk_findings
  add column kind public.finding_kind not null default 'playbook';
