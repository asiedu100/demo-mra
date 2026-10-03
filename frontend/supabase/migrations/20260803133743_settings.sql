-- Business Settings (admin-editable, everyone can read) + a personal
-- preference column on profiles for "My Settings" (default landing page).
begin;

create table if not exists public.business_settings (
  id smallint primary key default 1 check (id = 1), -- singleton row
  business_name text not null default '',
  phone text not null default '',
  address text not null default '',
  currency_symbol text not null default 'GH₵',
  default_reorder_level integer not null default 10,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.business_settings enable row level security;

drop policy if exists "business_settings_select" on public.business_settings;
create policy "business_settings_select" on public.business_settings
  for select to authenticated using (true);

drop policy if exists "business_settings_admin_write" on public.business_settings;
create policy "business_settings_admin_write" on public.business_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.business_settings to authenticated;
grant insert, update on public.business_settings to authenticated;

-- Seed the singleton row blank, relying on the column defaults above — a
-- fresh deployment (new client) must start with no business identity set,
-- so onboarding_completed correctly stays false and the setup wizard fires.
-- (On the live project this row was already backfilled with real contact
-- info directly; this file is already applied there, so editing it here
-- only affects a future deployment that runs migrations from scratch.)
insert into public.business_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.profiles add column if not exists default_landing_page text;

commit;
