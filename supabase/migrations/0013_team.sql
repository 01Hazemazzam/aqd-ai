-- Invite tokens follow the same shape as login codes: the plaintext exists
-- only in the email, the table stores only a hash, and a security-definer
-- function does the hashing (extensions.digest) rather than trusting the
-- caller to hash consistently. Membership CRUD itself (list/add/change role/
-- remove) uses the org_members/invites RLS policies already in place from
-- migration 0002 -- owner/admin can write directly, no function needed for
-- that part.
create or replace function public.create_invite(p_email text, p_role public.org_role)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_org     uuid := public.jwt_org_id();
  v_my_role public.org_role := public.jwt_org_role();
  v_token   text;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if v_org is null or v_my_role not in ('owner', 'admin') then raise exception 'not_authorized'; end if;
  -- Only an owner can invite another owner -- an admin granting owner would
  -- be a privilege escalation of the inviter's own role.
  if p_role = 'owner' and v_my_role <> 'owner' then raise exception 'not_authorized'; end if;

  perform public.bump_rate_limit(v_user::text, 'create_invite', 20);

  -- One live invite per (org, email); re-inviting replaces the old token
  -- rather than leaving two valid links for the same address.
  delete from public.invites where org_id = v_org and email = p_email and accepted_at is null;

  -- extensions.gen_random_bytes, not gen_random_bytes: same fix
  -- accept_invite() and device_digest() already needed for extensions.digest
  -- -- `set search_path = public` above pins the path away from `extensions`,
  -- where this pgcrypto function actually lives.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invites (org_id, email, role, token_hash, expires_at)
  values (v_org, p_email, p_role, extensions.digest(v_token, 'sha256'), now() + interval '7 days');

  insert into public.auth_events (user_id, org_id, kind) values (v_user, v_org, 'invite_created');

  return v_token;
end;
$$;

revoke execute on function public.create_invite(text, public.org_role) from public;
grant execute on function public.create_invite(text, public.org_role) to authenticated;

-- The last-owner guard ("an org must always keep at least one owner") is
-- deliberately NOT a trigger on org_members. A trigger fires for a cascaded
-- delete too -- when auth.users(id) is deleted, org_members cascades via its
-- FK, and a trigger has no clean way to tell "the team page removed this
-- member" apart from "this whole account is gone, org and all" (the latter
-- is exactly what test cleanup's `delete from auth.users` does, repeatedly,
-- across this test suite). Enforced instead in the team settings server
-- actions (changeMemberRole/removeMember), which is the only place a
-- deliberate "keep this member, but not as owner" or "remove this member"
-- decision actually gets made.

-- The `authenticated` role has no direct SELECT on auth.users (Supabase's
-- default), so a team-member list needs a security-definer function to read
-- emails -- same reason accept_invite() already reads auth.users this way.
-- Explicitly filtered to the caller's own org even though the function's own
-- privilege escalation would let it read everything; that filter is the only
-- thing keeping this from being a cross-org email leak.
create or replace function public.list_org_members()
returns table (user_id uuid, email text, role public.org_role, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = public.jwt_org_id()
  order by m.created_at asc;
$$;

revoke execute on function public.list_org_members() from public;
grant execute on function public.list_org_members() to authenticated;

-- Lets the onboarding screen show "{org} invited you to join as {role}"
-- before the user commits to accepting. invites_read RLS can't serve this:
-- the invitee has no matching org_id claim yet (that's the whole point of
-- the invite), so a plain select returns nothing. Read-only counterpart to
-- accept_invite() -- same lookup, no mutation, no return of the token hash.
create or replace function public.preview_invite(p_token text)
returns table (org_name text, role public.org_role)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, i.role
  from public.invites i
  join public.organizations o on o.id = i.org_id
  where i.token_hash = extensions.digest(p_token, 'sha256')
    and i.accepted_at is null
    and i.expires_at > now()
    and i.email = (select email from auth.users where id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid);
$$;

revoke execute on function public.preview_invite(text) from public;
grant execute on function public.preview_invite(text) to authenticated;
