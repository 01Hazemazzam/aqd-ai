create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  membership record;
  claims jsonb;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  select org_id, role into membership
  from public.org_members
  where user_id = (event ->> 'user_id')::uuid
  order by created_at asc
  limit 1;

  if membership.org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(membership.org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(membership.role::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Reads the org from the JWT, falling back to the membership table.
-- The fallback matters: a token minted before the user joined an organisation
-- carries no claim, and without it that user is locked out of their own data.
create or replace function public.jwt_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')::uuid,
    (select org_id from public.org_members
      where user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      order by created_at asc limit 1)
  );
$$;

create or replace function public.jwt_org_role()
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_role', '')::public.org_role,
    (select role from public.org_members
      where user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
      order by created_at asc limit 1)
  );
$$;

create policy org_read on public.organizations
  for select using (id = public.jwt_org_id());

create policy members_read on public.org_members
  for select using (org_id = public.jwt_org_id());

create policy members_admin_write on public.org_members
  for all using (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'))
  with check (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'));

create policy invites_read on public.invites
  for select using (org_id = public.jwt_org_id());

create policy invites_admin_write on public.invites
  for all using (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'))
  with check (org_id = public.jwt_org_id() and public.jwt_org_role() in ('owner', 'admin'));
