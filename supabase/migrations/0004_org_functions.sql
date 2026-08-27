create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_base text;
  v_slug text;
  v_org  uuid;
  v_n    int := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  v_base := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'org'; end if;
  v_slug := v_base;

  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;

  insert into public.organizations (name, slug) values (trim(p_name), v_slug) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into public.auth_events (user_id, org_id, kind) values (v_user, v_org, 'org_created');

  return v_org;
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_email  citext;
  v_invite record;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email into v_email from auth.users where id = v_user;

  select * into v_invite
  from public.invites
  where token_hash = extensions.digest(p_token, 'sha256')
    and accepted_at is null
    and expires_at > now()
    and email = v_email
  for update;

  if v_invite.id is null then
    raise exception 'invite_invalid';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_invite.org_id, v_user, v_invite.role)
  on conflict (org_id, user_id) do nothing;

  update public.invites set accepted_at = now() where id = v_invite.id;
  insert into public.auth_events (user_id, org_id, kind) values (v_user, v_invite.org_id, 'invite_accepted');

  return v_invite.org_id;
end;
$$;

revoke execute on function public.create_organization(text) from public;
revoke execute on function public.accept_invite(text) from public;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
