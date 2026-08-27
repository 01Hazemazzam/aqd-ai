-- The stored value is a hash of the secret salted with the user id, so a
-- database dump yields nothing an attacker can present as a device.
-- extensions.digest, not digest: this function is always called from inside
-- trust_device()/is_device_trusted(), both `security definer set search_path
-- = public` — that pin applies for the duration of the outer call, including
-- nested calls made within it, so an unqualified digest() would fail to
-- resolve here too. Same root cause Task 9's implementer found in
-- accept_invite().
create or replace function public.device_digest(p_user uuid, p_secret text)
returns bytea
language sql
immutable
as $$
  select extensions.digest(p_user::text || ':' || p_secret, 'sha256');
$$;

create or replace function public.trust_device(p_secret text, p_user_agent text, p_days int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_id   uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  insert into public.trusted_devices (user_id, device_hash, user_agent, label, expires_at)
  values (v_user, public.device_digest(v_user, p_secret), p_user_agent, p_user_agent,
          now() + make_interval(days => greatest(p_days, 1)))
  on conflict (user_id, device_hash) do update
    set last_seen_at = now(),
        revoked_at = null,
        expires_at = now() + make_interval(days => greatest(p_days, 1))
  returning id into v_id;

  insert into public.auth_events (user_id, kind, user_agent) values (v_user, 'device_trusted', p_user_agent);
  return v_id;
end;
$$;

create or replace function public.is_device_trusted(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_hit  boolean;
begin
  if v_user is null or p_secret is null or p_secret = '' then return false; end if;

  update public.trusted_devices
  set last_seen_at = now()
  where user_id = v_user
    and device_hash = public.device_digest(v_user, p_secret)
    and revoked_at is null
    and expires_at > now()
  returning true into v_hit;

  return coalesce(v_hit, false);
end;
$$;

create or replace function public.revoke_all_devices()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  v_n    int;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  update public.trusted_devices set revoked_at = now()
  where user_id = v_user and revoked_at is null;
  get diagnostics v_n = row_count;

  insert into public.auth_events (user_id, kind) values (v_user, 'device_revoked');
  return v_n;
end;
$$;

revoke execute on function public.trust_device(text, text, int) from public;
revoke execute on function public.is_device_trusted(text) from public;
revoke execute on function public.revoke_all_devices() from public;
grant execute on function public.trust_device(text, text, int) to authenticated;
grant execute on function public.is_device_trusted(text) to authenticated;
grant execute on function public.revoke_all_devices() to authenticated;
