-- DEV-ONLY convenience. Locally there is no email transport, so a person
-- testing by hand has no way to receive their verification/challenge code and
-- gets stuck on the verify/challenge screen. This returns the *caller's own*
-- current live code so the dev screens can display it.
--
-- Codes are stored only as sha256 hashes (issue_code returns the plaintext
-- once, then discards it), so the plaintext cannot be looked up -- it has to be
-- recovered by brute-forcing the 6-digit space against the stored hash. That is
-- the exact technique the e2e suite already uses to read codes, and at 10^6
-- candidates it costs a second or two, which is fine for a dev-only reveal.
--
-- Safe by construction: it derives the subject solely from the caller's own JWT
-- `sub` (like every other function here), so a caller can only ever recover a
-- code that was about to be emailed to them anyway -- no cross-user exposure and
-- no privilege escalation. The application layer (lib/auth/dev-code.ts) refuses
-- to call it at all outside development, as a second gate.
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
