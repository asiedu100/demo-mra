-- First-admin bootstrap: lets a brand-new deployment create its very first
-- admin account from inside the app instead of by hand in the Supabase
-- dashboard. Self-closing by design -- once any admin exists, this path
-- can never be used again.
begin;

-- Lets the pre-login frontend (anon role) check whether the one-time admin
-- bootstrap screen should still be shown. Deliberately counts inactive
-- admins too, so deactivating the sole admin can never reopen the
-- bootstrap hole. This is the single source of truth reused by
-- bootstrap_first_admin() below -- the frontend gate and the atomic
-- backend check must never diverge.
create or replace function public.any_admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where role = 'admin');
$$;

revoke execute on function public.any_admin_exists() from public;
grant execute on function public.any_admin_exists() to anon, authenticated, service_role;

-- Creates the very first admin account atomically. pg_advisory_xact_lock
-- serializes concurrent callers (double-clicked submit, two tabs racing,
-- or a probe) so "does an admin exist yet" and the insert can never
-- interleave -- exactly one caller can ever win. Only callable via the
-- service-role client (the bootstrap-first-admin Edge Function); NOT
-- granted to anon, so all input validation stays funneled through the
-- Edge Function. The auth.users row for p_id must already exist (created
-- via the Admin API) before this runs.
create or replace function public.bootstrap_first_admin(
  p_id uuid,
  p_email text,
  p_username text,
  p_full_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  perform pg_advisory_xact_lock(hashtext('bootstrap_first_admin'));

  if public.any_admin_exists() then
    raise exception 'An admin account already exists.' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, email, username, full_name, role, location, active, must_change_password)
  values (p_id, p_email, p_username, p_full_name, 'admin', 'All', true, false)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.bootstrap_first_admin(uuid, text, text, text) from public;
grant execute on function public.bootstrap_first_admin(uuid, text, text, text) to service_role;

commit;
