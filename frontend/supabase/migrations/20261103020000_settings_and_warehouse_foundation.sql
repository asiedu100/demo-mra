-- MRA settings and branch-backed warehouse foundation.

alter table if exists public.business_profile
  add column if not exists brand_color text not null default '#5C2D0A';

update public.business_profile
set brand_color = '#5C2D0A'
where brand_color is null or trim(brand_color) = '';

alter table if exists public.business_profile
  drop constraint if exists business_profile_brand_color_check;

alter table if exists public.business_profile
  add constraint business_profile_brand_color_check
  check (brand_color ~ '^#[0-9A-Fa-f]{6}$');
