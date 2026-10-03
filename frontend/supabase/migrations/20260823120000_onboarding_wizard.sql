-- Onboarding: a one-time business-setup wizard for the first admin, and a
-- one-time feature tour for new staff accounts.
begin;

-- Business setup wizard: singleton flag. Backfill true for the existing
-- seeded row (already has real data) so current admins are never shown
-- the wizard unexpectedly; any future fresh row with a blank name stays false.
alter table public.business_settings add column if not exists onboarding_completed boolean not null default false;
update public.business_settings set onboarding_completed = true
  where trim(coalesce(business_name, '')) <> '';

-- Staff feature tour: per-user "seen" flag. Backfill true for every
-- existing profile (they've already been using the app) so only staff
-- accounts created after this migration get the tour.
alter table public.profiles add column if not exists has_seen_tour boolean not null default false;
update public.profiles set has_seen_tour = true;

-- Lets a staff member mark their own tour as seen, mirroring
-- complete_password_change()/record_login() — profiles has no self-update
-- RLS policy, only profiles_admin_write, so this must run as the row owner.
create or replace function public.complete_staff_tour()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles
  set has_seen_tour = true,
      updated_at = now()
  where id = auth.uid();
end;
$$;

revoke execute on function public.complete_staff_tour() from public;
grant execute on function public.complete_staff_tour() to authenticated;

commit;
