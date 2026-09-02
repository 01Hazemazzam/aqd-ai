-- LOCAL DEVELOPMENT ONLY. Applied by `supabase db reset`; never by
-- `supabase db push`, which pushes migrations and nothing else. That
-- asymmetry is the whole point: migration 0020 drops `dev_peek_code` so it
-- cannot exist in a deployed database, and this file puts it back on the one
-- kind of database that has no email transport to replace it.
--
-- Read the comment on 0020 before moving any of this into a migration.
--
-- Anything else this file grows must hold to the same rule: it is a
-- convenience for a database that only ever contains throwaway data, and it
-- must not be something production would also want. If production would want
-- it, it belongs in a migration.

create or replace function public.dev_peek_code(p_purpose public.code_purpose)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_hash bytea;
  v_code text;
begin
  if v_user is null then
    return null;
  end if;

  select code_hash into v_hash
  from public.login_codes
  where user_id = v_user and purpose = p_purpose and consumed_at is null and expires_at > now()
  order by created_at desc
  limit 1;

  if v_hash is null then
    return null;
  end if;

  select s.code into v_code
  from generate_series(0, 999999) g(n),
       lateral (select lpad(g.n::text, 6, '0') as code) s
  where extensions.digest(s.code, 'sha256') = v_hash
  limit 1;

  return v_code;
end;
$$;

revoke execute on function public.dev_peek_code(public.code_purpose) from public, anon;
grant execute on function public.dev_peek_code(public.code_purpose) to authenticated;
