-- login_failed couldn't be written as a direct insert: events_own_insert's
-- RLS check requires user_id = auth.uid(), but auth.uid() is null at the
-- moment of a failed login -- the caller isn't authenticated yet. A
-- security-definer function bridges that, the same way issue_code/
-- verify_code already do for login_codes.
--
-- Takes the plaintext email, not a user id: login/actions.ts only ever has
-- the email at this point, before knowing whether the password matched.
-- Looks the user up internally and writes nothing at all when no such user
-- exists -- same shape, same timing regardless of outcome, and the caller
-- calls this identically either way -- so this cannot become a second
-- account-enumeration oracle alongside signInWithPassword's own uniform
-- error message.
create or replace function public.log_login_failed(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_email is null or p_email = '' then
    return;
  end if;

  select id into v_user from auth.users where email = p_email;
  if v_user is not null then
    insert into public.auth_events (user_id, kind) values (v_user, 'login_failed');
  end if;
end;
$$;

-- Callable pre-authentication (a failed login has no session yet), unlike
-- virtually every other definer function in this app -- this is the one
-- place `anon` needs a grant here, matching the same public-REST trust
-- level signInWithPassword itself already runs at.
revoke execute on function public.log_login_failed(text) from public;
grant execute on function public.log_login_failed(text) to anon, authenticated;
