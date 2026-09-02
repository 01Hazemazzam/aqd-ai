-- Two structural changes the Intelligence assistant needs, and nothing else.
--
-- 1. A chat can be scoped to the whole portfolio instead of to one contract.
-- 2. A citation can point at a risk finding, not only at a clause.

-- ---------------------------------------------------------------------------
-- Portfolio scope
-- ---------------------------------------------------------------------------
-- `contract_id` becomes nullable, and null means "this conversation is about
-- the portfolio". The two scopes stay separate threads deliberately: Contract
-- chat's guarantee is that every fact traces to a clause of THAT document,
-- and a portfolio answer is grounded in aggregation output instead. One
-- thread holding both would have to carry both rule sets, and would open the
-- exact path the cross-contract isolation test exists to close.
alter table public.chats alter column contract_id drop not null;

-- The old table-level `unique (contract_id)` treats every portfolio row's
-- NULL as distinct, so it would let an org accumulate unlimited portfolio
-- threads. Replaced by two partial indexes that each say what they mean.
alter table public.chats drop constraint chats_contract_id_key;

create unique index chats_contract_unique on public.chats (contract_id) where contract_id is not null;

-- One portfolio conversation per org -- the same MVP simplification the
-- per-contract rule already makes, for the same reason: this is a grounded
-- assistant, not a multi-thread chat product.
create unique index chats_portfolio_unique on public.chats (org_id) where contract_id is null;

-- ---------------------------------------------------------------------------
-- Finding citations
-- ---------------------------------------------------------------------------
-- A citation could previously only point at a clause, which quietly meant the
-- assistant could never state a risk about a clause the document DOESN'T
-- have -- there is nothing to point at. That is not an edge case: 5 of the 12
-- findings in the current corpus have no clause, so clause-only citation
-- silenced 42% of the risk evidence.
--
-- Exactly one new target, not a polymorphic one. Obligations and milestones
-- already carry the clause they came from, so they cite through it; a finding
-- with no clause is the only evidence-bearing record with nothing to cite
-- through.
alter table public.citations alter column clause_id drop not null;

alter table public.citations
  add column finding_id uuid references public.risk_findings(id) on delete cascade;

-- The invariant in the database rather than in the code that writes it: a
-- citation points at exactly one thing. A row with neither is an uncited
-- claim wearing a citation's clothes, and a row with both is ambiguous about
-- where a click should land.
alter table public.citations
  add constraint citations_exactly_one_target check (num_nonnulls(clause_id, finding_id) = 1);

create index citations_finding_idx on public.citations (finding_id) where finding_id is not null;
