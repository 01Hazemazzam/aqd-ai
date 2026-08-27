create type public.code_purpose as enum ('signup_verify', 'device_challenge');

create table public.login_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  code_hash     bytea not null,
  purpose       public.code_purpose not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  attempt_count int not null default 0,
  created_at    timestamptz not null default now()
);

create index login_codes_live_idx
  on public.login_codes (user_id, purpose)
  where consumed_at is null;

create table public.trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_hash  bytea not null,
  label        text,
  user_agent   text,
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, device_hash)
);

create index trusted_devices_live_idx
  on public.trusted_devices (user_id)
  where revoked_at is null;

create table public.rate_limits (
  subject      text not null,
  action       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (subject, action, window_start)
);

create table public.auth_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null default auth.uid(),
  org_id     uuid references public.organizations(id) on delete set null,
  kind       text not null,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index auth_events_user_idx on public.auth_events (user_id, created_at desc);

alter table public.login_codes     enable row level security;
alter table public.trusted_devices enable row level security;
alter table public.rate_limits     enable row level security;
alter table public.auth_events     enable row level security;

-- login_codes deliberately has NO policy at all. Every access goes through a
-- security definer function, so a user cannot read their own code hash even
-- with a valid session and an arbitrary query.

create policy devices_own_read on public.trusted_devices
  for select using (user_id = auth.uid());

create policy devices_own_revoke on public.trusted_devices
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy events_own_read on public.auth_events
  for select using (user_id = auth.uid());

-- The app records its own security events (a failed code send, for instance).
-- A user may write events attributed to themselves and read them back; they
-- can never write one attributed to somebody else.
create policy events_own_insert on public.auth_events
  for insert with check (user_id = auth.uid());

-- rate_limits has no policy either; only definer functions touch it.
