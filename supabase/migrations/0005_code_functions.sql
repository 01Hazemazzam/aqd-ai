-- Bumps a counter and raises if the caller is over the limit.
create or replace function public.bump_rate_limit(p_subject text, p_action text, p_limit int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count  int;
begin
  insert into public.rate_limits (subject, action, window_start, count)
  values (p_subject, p_action, v_window, 1)
  on conflict (subject, action, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if v_count > p_limit then
    raise exception 'rate_limited';
  end if;
end;
$$;

create or replace function public.issue_code(p_purpose public.code_purpose, p_ip text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_code text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  perform public.bump_rate_limit(v_user::text, 'issue_code', 5);
  if p_ip is not null and p_ip <> '' then
    perform public.bump_rate_limit(p_ip, 'issue_code_ip', 5);
  end if;

  -- Only one live code per purpose. Issuing a new one retires the old.
  update public.login_codes
  set consumed_at = now()
  where user_id = v_user and purpose = p_purpose and consumed_at is null;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- extensions.digest: this stack installs pgcrypto in `extensions`, and
  -- `set search_path = public` above pins the path away from it — same fix
  -- Task 9's implementer found and applied to accept_invite().
  insert into public.login_codes (user_id, code_hash, purpose, expires_at)
  values (v_user, extensions.digest(v_code, 'sha256'), p_purpose, now() + interval '10 minutes');

  insert into public.auth_events (user_id, kind) values (v_user, 'code_sent');

  return v_code;
end;
$$;

create or replace function public.verify_code(p_code text, p_purpose public.code_purpose)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_row  public.login_codes;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- FOR UPDATE is load-bearing: without the row lock, two parallel requests
  -- can both pass against a single-use code.
  select * into v_row
  from public.login_codes
  where user_id = v_user and purpose = p_purpose and consumed_at is null
  order by created_at desc
  limit 1
  for update;

  -- Failures are RETURNED, never raised. `raise` aborts the transaction, which
  -- would roll back the very attempt_count increment that burns the code after
  -- five tries — the counter would sit at zero forever and the limit would
  -- never fire. Returning a status is what makes the counter durable.
  if v_row.id is null then
    return 'code_incorrect';
  end if;

  if v_row.expires_at <= now() then
    update public.login_codes set consumed_at = now() where id = v_row.id;
    return 'code_expired';
  end if;

  if v_row.code_hash <> extensions.digest(p_code, 'sha256') then
    update public.login_codes
    set attempt_count = attempt_count + 1,
        consumed_at = case when attempt_count + 1 >= 5 then now() else null end
    where id = v_row.id;

    insert into public.auth_events (user_id, kind) values (v_user, 'code_failed');

    if v_row.attempt_count + 1 >= 5 then
      return 'code_burned';
    end if;
    return 'code_incorrect';
  end if;

  update public.login_codes set consumed_at = now() where id = v_row.id;
  return 'ok';
end;
$$;

revoke execute on function public.issue_code(public.code_purpose, text) from public;
revoke execute on function public.verify_code(text, public.code_purpose) from public;
grant execute on function public.issue_code(public.code_purpose, text) to authenticated;
grant execute on function public.verify_code(text, public.code_purpose) to authenticated;
