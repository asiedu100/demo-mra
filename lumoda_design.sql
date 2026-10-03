-- LUMODA ENTERPRISE Supabase schema
-- Run this in Supabase Dashboard > SQL Editor.
-- After running it, keep Row Level Security enabled on every business table.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'staff', 'warehouse_manager');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.branch_location as enum ('All', 'Alabar', 'Morocco');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.invoice_status as enum ('paid', 'pending', 'partial');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_method as enum ('cash', 'momo');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  full_name text not null,
  role public.user_role not null default 'staff',
  location public.branch_location not null default 'Alabar',
  active boolean not null default true,
  must_change_password boolean not null default false,
  has_seen_tour boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (role in ('admin', 'warehouse_manager') and location = 'All')
    or (role = 'staff' and location in ('Alabar', 'Morocco'))
  )
);

alter table public.profiles
  add column if not exists email text;

create unique index if not exists profiles_email_idx
  on public.profiles (lower(email))
  where email is not null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text not null default 'General',
  price numeric(12,2) not null check (price >= 0),
  retail_price numeric(12,2) not null default 0 check (retail_price >= 0),
  wholesale_price numeric(12,2) not null default 0 check (wholesale_price >= 0),
  carton_price numeric(12,2) not null default 0 check (carton_price >= 0),
  stock_alabar integer not null default 0 check (stock_alabar >= 0),
  stock_morocco integer not null default 0 check (stock_morocco >= 0),
  reorder_level integer not null default 5 check (reorder_level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column if not exists retail_price numeric(12,2) not null default 0 check (retail_price >= 0),
  add column if not exists wholesale_price numeric(12,2) not null default 0 check (wholesale_price >= 0),
  add column if not exists carton_price numeric(12,2) not null default 0 check (carton_price >= 0);

update public.products
set retail_price = case when retail_price = 0 then price else retail_price end,
    wholesale_price = case when wholesale_price = 0 then price else wholesale_price end,
    carton_price = case when carton_price = 0 then price else carton_price end;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  location public.branch_location not null check (location in ('Alabar', 'Morocco')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.invoice_number_seq start with 2388;

create or replace function public.generate_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return lpad(nextval('public.invoice_number_seq')::text, 6, '0');
end;
$$;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default public.generate_invoice_number(),
  customer_id uuid references public.customers(id),
  customer_name text not null,
  customer_phone text,
  customer_address text,
  location public.branch_location not null check (location in ('Alabar', 'Morocco')),
  total numeric(12,2) not null default 0 check (total >= 0),
  status public.invoice_status not null default 'pending',
  pay_method public.payment_method,
  momo_number text,
  notes text,
  created_by uuid not null references auth.users(id),
  deleted boolean not null default false,
  deleted_by uuid references auth.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices
alter column number set default public.generate_invoice_number();

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id),
  name text not null,
  sale_type text not null default 'retail' check (sale_type in ('retail', 'wholesale', 'carton')),
  qty integer not null check (qty > 0),
  price numeric(12,2) not null check (price >= 0),
  total numeric(12,2) generated always as (qty * price) stored
);

alter table public.invoice_items
  add column if not exists sale_type text not null default 'retail' check (sale_type in ('retail', 'wholesale', 'carton'));

create table if not exists public.stock_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  product_name text not null,
  location public.branch_location not null check (location in ('Alabar', 'Morocco')),
  change integer not null,
  type text not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  detail text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Partial-payment / cash-sale support, added directly on the live project
-- after this file was first written. Captured here so the file matches
-- what's actually running (baseline sync).
alter table public.invoices
  add column if not exists subtotal numeric(12,2) default 0,
  add column if not exists discount numeric(12,2) default 0,
  add column if not exists amount_paid numeric(12,2) not null default 0,
  add column if not exists balance numeric(12,2) not null default 0,
  add column if not exists partial_method text,
  add column if not exists partial_momo_number text,
  add column if not exists is_cash_sale boolean not null default false,
  add column if not exists cash_tendered numeric(12,2);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  method text,
  momo_number text,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_id_idx on public.invoice_payments(invoice_id);

-- Discount / item-change requests from non-admin staff, held for admin
-- approval instead of being applied directly (see create_invoice_no_stock
-- and update_invoice_no_stock below).
create table if not exists public.invoice_edit_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id),
  request_type text not null check (request_type in ('item_change', 'discount')),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text
);

create index if not exists invoice_edit_requests_pending_idx
  on public.invoice_edit_requests (status, requested_at desc)
  where status = 'pending';

-- Warehouse schema lives in `supabase-warehouse-schema.sql` to keep it separate
-- from the core auth, invoicing, customer, and product schema.

create or replace function public.log_audit(
  p_action text,
  p_detail text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_log_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values (trim(p_action), trim(p_detail), v_user)
  returning id into v_log_id;

  return v_log_id;
end;
$$;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_location_idx on public.profiles(location);
create index if not exists products_sku_idx on public.products(sku);
create index if not exists customers_location_idx on public.customers(location);
create index if not exists invoices_location_idx on public.invoices(location);
create index if not exists invoices_created_by_idx on public.invoices(created_by);
create index if not exists invoices_location_created_at_idx on public.invoices(location, created_at desc);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);
create index if not exists stock_history_product_location_idx on public.stock_history(product_id, location);
create index if not exists stock_history_location_idx on public.stock_history(location);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at before update on public.customers
for each row execute function public.touch_updated_at();

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at before update on public.invoices
for each row execute function public.touch_updated_at();

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
  where id = (select auth.uid()) and active = true
$$;

create or replace function public.current_profile_location()
returns public.branch_location
language sql
stable
security definer
set search_path = public
as $$
  select location from public.profiles
  where id = (select auth.uid()) and active = true
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.can_access_location(row_location public.branch_location)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or public.current_profile_location() = 'All'
    or public.current_profile_location() = row_location,
    false
  )
$$;

create or replace function public.complete_password_change()
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
  set must_change_password = false,
      updated_at = now()
  where id = auth.uid();
end;
$$;

-- Lets a staff member mark their own onboarding tour as seen, mirroring
-- complete_password_change() above — profiles has no self-update RLS
-- policy, only profiles_admin_write, so this must run as the row owner.
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

-- First-admin bootstrap: lets a brand-new deployment create its very first
-- admin account from inside the app instead of by hand in the Supabase
-- dashboard. Self-closing by design -- once any admin exists, this path
-- can never be used again.

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

create or replace function public.generate_product_sku(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_slug text;
begin
  v_slug := upper(
    trim(
      both '-' from regexp_replace(
        regexp_replace(trim(coalesce(p_name, '')), $rx$[.'"]$rx$, '', 'g'),
        '[^A-Za-z0-9]+',
        '-',
        'g'
      )
    )
  );

  if v_slug = '' then
    v_slug := 'PRODUCT';
  end if;

  return 'LMD-' || v_slug;
end;
$$;

drop function if exists public.import_products(jsonb, text, text, integer);
drop function if exists public.import_products(jsonb, text, text, integer, boolean);

create or replace function public.import_products(
  p_products jsonb,
  p_stock_target text default 'both',
  p_default_category text default 'General',
  p_default_reorder integer default 5,
  p_replace_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_name text;
  v_sku text;
  v_category text;
  v_price numeric(12,2);
  v_stock integer;
  v_stock_alabar integer;
  v_stock_morocco integer;
  v_reorder integer;
  v_added integer := 0;
  v_updated integer := 0;
  v_existing uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can import products';
  end if;

  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'Products must be a JSON array';
  end if;

  if p_stock_target not in ('both', 'alabar', 'morocco') then
    raise exception 'Invalid stock target';
  end if;

  for v_item in select * from jsonb_array_elements(p_products)
  loop
    v_name := trim(coalesce(v_item->>'name', v_item->>'NAME', ''));
    if v_name = '' then
      continue;
    end if;

    v_price := coalesce(nullif(v_item->>'price', '')::numeric, nullif(v_item->>'PRICE', '')::numeric, 0);
    if v_price < 0 then
      raise exception 'Invalid price for %', v_name;
    end if;

    v_stock := coalesce(nullif(v_item->>'stock', '')::integer, nullif(v_item->>'STOCK', '')::integer, 0);
    if v_stock < 0 then
      raise exception 'Invalid stock for %', v_name;
    end if;

    v_stock_alabar := coalesce(nullif(v_item->>'stock_alabar', '')::integer, nullif(v_item->>'STOCK_ALABAR', '')::integer, case when p_stock_target in ('both', 'alabar') then v_stock else 0 end);
    v_stock_morocco := coalesce(nullif(v_item->>'stock_morocco', '')::integer, nullif(v_item->>'STOCK_MOROCCO', '')::integer, case when p_stock_target in ('both', 'morocco') then v_stock else 0 end);

    if v_stock_alabar < 0 or v_stock_morocco < 0 then
      raise exception 'Invalid branch stock for %', v_name;
    end if;

    v_category := nullif(trim(coalesce(v_item->>'category', v_item->>'CATEGORY', p_default_category, 'General')), '');
    v_reorder := coalesce(nullif(v_item->>'reorder_level', '')::integer, nullif(v_item->>'REORDER_LEVEL', '')::integer, p_default_reorder, 5);
    if v_reorder < 0 then
      raise exception 'Invalid reorder level for %', v_name;
    end if;

    v_sku := nullif(trim(coalesce(v_item->>'sku', v_item->>'SKU', '')), '');
    if v_sku is null then
      v_sku := public.generate_product_sku(v_name);
    end if;

    select id into v_existing
    from public.products
    where sku = v_sku;

    insert into public.products (name, sku, category, price, stock_alabar, stock_morocco, reorder_level)
    values (v_name, v_sku, v_category, v_price, v_stock_alabar, v_stock_morocco, v_reorder)
    on conflict (sku) do update
    set name = excluded.name,
        category = excluded.category,
        price = excluded.price,
        stock_alabar = case when p_replace_stock then excluded.stock_alabar else public.products.stock_alabar end,
        stock_morocco = case when p_replace_stock then excluded.stock_morocco else public.products.stock_morocco end,
        reorder_level = excluded.reorder_level;

    if v_existing is null then
      v_added := v_added + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  insert into public.audit_logs (action, detail, created_by)
  values ('Products Imported', 'Products import completed: ' || v_added || ' added, ' || v_updated || ' updated', v_user);

  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

create or replace function public.create_invoice(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty integer;
  v_price numeric(12,2);
  v_sale_type text;
  v_item_total numeric(12,2);
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select role, location
    into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then
    raise exception 'Active profile not found';
  end if;

  if p_location not in ('Alabar', 'Morocco') then
    raise exception 'Invalid invoice location';
  end if;

  if v_role <> 'admin' and p_location <> v_user_location then
    raise exception 'You cannot create invoices for this branch';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;

  if p_status = 'paid' and p_pay_method is null then
    raise exception 'Payment method is required for paid invoices';
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice requires at least one item';
  end if;

  select id
    into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (trim(p_customer_name), nullif(trim(coalesce(p_customer_phone, '')), ''), nullif(trim(coalesce(p_customer_address, '')), ''), p_location, v_user)
    returning id into v_customer_id;
  end if;

  insert into public.invoices (
    customer_id,
    customer_name,
    customer_phone,
    customer_address,
    location,
    total,
    status,
    pay_method,
    momo_number,
    notes,
    created_by
  )
  values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    0,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user
  )
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'qty')::integer, 0);

    if v_qty < 1 then
      raise exception 'Quantity must be greater than zero';
    end if;

    select *
      into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception 'Product not found';
    end if;

    if p_location = 'Alabar' then
      if v_product.stock_alabar < v_qty then
        raise exception 'Not enough stock for % at Alabar', v_product.name;
      end if;

      update public.products
      set stock_alabar = stock_alabar - v_qty
      where id = v_product.id;
    else
      if v_product.stock_morocco < v_qty then
        raise exception 'Not enough stock for % at Morocco', v_product.name;
      end if;

      update public.products
      set stock_morocco = stock_morocco - v_qty
      where id = v_product.id;
    end if;

    v_item_total := v_product.price * v_qty;
    v_total := v_total + v_item_total;

    insert into public.invoice_items (invoice_id, product_id, name, qty, price)
    values (v_invoice_id, v_product.id, v_product.name, v_qty, v_product.price);

    insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
    values (v_product.id, v_product.name, p_location, -v_qty, 'Sale', 'Invoice created', v_user);
  end loop;

  update public.invoices
  set total = v_total
  where id = v_invoice_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || (select number from public.invoices where id = v_invoice_id) || ' created for ' || trim(p_customer_name), v_user);

  return v_invoice_id;
exception
  when invalid_text_representation then
    raise exception 'Invalid invoice item product id';
end;
$$;

-- NOTE: this replaces the original 9-param version. The live project grew it
-- to 15 params (partial payments / cash sales / discount-approval routing)
-- without this file being updated to match — captured here (baseline sync).
create or replace function public.create_invoice_no_stock(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null,
  p_amount_paid numeric default 0,
  p_discount numeric default 0,
  p_partial_method text default null,
  p_partial_momo text default null,
  p_is_cash_sale boolean default false,
  p_cash_tendered numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_id uuid;
  v_number text;
  v_customer_id uuid;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_effective_paid numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric(12,2);
  v_sale_type text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;
  if p_location not in ('Alabar', 'Morocco') then raise exception 'Invalid invoice location'; end if;
  if v_role <> 'admin' and p_location <> v_user_location then raise exception 'You cannot create invoices for this branch'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Invoice requires at least one item'; end if;
  if p_status = 'paid' and p_pay_method is null then raise exception 'Payment method is required for paid invoices'; end if;

  -- Any discount from a non-admin is held for approval instead of applied.
  -- Nothing is created yet — the customer record, invoice, and items are
  -- only produced once an admin approves the request (approve_invoice_request).
  if v_role <> 'admin' and coalesce(p_discount, 0) > 0 then
    insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
    values (
      null,
      'discount',
      v_user,
      jsonb_build_object(
        'p_customer_name', p_customer_name,
        'p_location', p_location,
        'p_items', p_items,
        'p_customer_phone', p_customer_phone,
        'p_customer_address', p_customer_address,
        'p_status', p_status,
        'p_pay_method', p_pay_method,
        'p_momo_number', p_momo_number,
        'p_notes', p_notes,
        'p_amount_paid', p_amount_paid,
        'p_discount', p_discount,
        'p_partial_method', p_partial_method,
        'p_partial_momo', p_partial_momo,
        'p_is_cash_sale', p_is_cash_sale,
        'p_cash_tendered', p_cash_tendered
      )
    );
    return jsonb_build_object('success', true, 'discount_pending_approval', true);
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  select id into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_address, '')), ''),
      p_location,
      v_user
    ) returning id into v_customer_id;
  else
    update public.customers
    set phone = coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), phone),
        address = coalesce(nullif(trim(coalesce(p_customer_address, '')), ''), address)
    where id = v_customer_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);

    if v_item_name = '' then raise exception 'Item name is required'; end if;
    if v_item_qty < 1 then raise exception 'Quantity must be greater than zero'; end if;
    if v_item_price < 0 then raise exception 'Price cannot be negative'; end if;

    v_subtotal := v_subtotal + (v_item_qty * v_item_price);
  end loop;

  if v_subtotal <= 0 then raise exception 'Invoice total must be greater than zero'; end if;

  v_total := greatest(v_subtotal - coalesce(p_discount, 0), 0);

  v_effective_paid := case
    when p_status = 'paid' then v_total
    when p_status = 'partial' then least(greatest(coalesce(p_amount_paid, 0), 0), v_total)
    else 0
  end;

  insert into public.invoices (
    customer_id, customer_name, customer_phone, customer_address,
    location, subtotal, discount, total, status, pay_method, momo_number, notes,
    amount_paid, balance, partial_method, partial_momo_number, is_cash_sale, cash_tendered, created_by
  ) values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    v_subtotal,
    coalesce(p_discount, 0),
    v_total,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_effective_paid,
    greatest(v_total - v_effective_paid, 0),
    p_partial_method,
    nullif(trim(coalesce(p_partial_momo, '')), ''),
    coalesce(p_is_cash_sale, false),
    p_cash_tendered,
    v_user
  ) returning id, number into v_invoice_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);
    v_sale_type := coalesce(nullif(v_item->>'sale_type', ''), nullif(v_item->>'priceType', ''), 'retail');
    v_product_id := null;

    if nullif(v_item->>'product_id', '') is not null and v_item->>'product_id' <> 'null' then
      select id into v_product_id
      from public.products
      where id = (v_item->>'product_id')::uuid
      limit 1;
    end if;

    if v_product_id is null then
      select id into v_product_id
      from public.products
      where lower(name) = lower(v_item_name)
      limit 1;
    end if;

    insert into public.invoice_items (invoice_id, product_id, name, sale_type, qty, price)
    values (v_invoice_id, v_product_id, v_item_name, v_sale_type, v_item_qty, v_item_price);
  end loop;

  if v_effective_paid > 0 then
    insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
    values (
      v_invoice_id,
      v_effective_paid,
      coalesce(p_pay_method::text, p_partial_method),
      coalesce(p_momo_number, p_partial_momo),
      'Initial payment',
      v_user
    );
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || v_number || ' created for ' || trim(p_customer_name), v_user);

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'number', v_number,
    'subtotal', v_subtotal,
    'discount', coalesce(p_discount, 0),
    'total', v_total,
    'paid', v_effective_paid,
    'balance', greatest(v_total - v_effective_paid, 0)
  );
end;
$$;

-- Edits an existing invoice. Item-quantity *reductions* from a non-admin are
-- held for approval (invoice_edit_requests) rather than applied immediately;
-- everything else (status/payment/notes/customer details, or any change from
-- an admin) applies right away.
create or replace function public.update_invoice_no_stock(
  p_invoice_id uuid,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status text default null,
  p_pay_method text default null,
  p_momo_number text default null,
  p_notes text default null,
  p_subtotal numeric default null,
  p_total numeric default null,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_location public.branch_location;
  v_invoice_status public.invoice_status;
  v_invoice jsonb;
  v_items jsonb;
  v_current_key text;
  v_current_qty integer;
  v_proposed_qty integer;
  v_needs_approval boolean := false;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;

  select location, status into v_invoice_location, v_invoice_status
  from public.invoices
  where id = p_invoice_id and deleted = false;

  if not found then raise exception 'Invoice not found'; end if;
  if v_role <> 'admin' and v_invoice_location <> v_user_location then
    raise exception 'You cannot edit invoices for this branch';
  end if;

  if p_items is not null and jsonb_array_length(p_items) > 0
     and v_invoice_status in ('paid', 'partial') and v_role <> 'admin' then
    raise exception 'This invoice is already paid or partially paid — ask an admin to make item changes';
  end if;

  if p_items is not null and jsonb_array_length(p_items) > 0 and v_role <> 'admin' then
    for v_current_key, v_current_qty in
      select coalesce(name,'') || '|' || coalesce(sale_type,'retail'), sum(qty)::integer
      from public.invoice_items
      where invoice_id = p_invoice_id
      group by 1
    loop
      select coalesce(sum((item->>'qty')::integer), 0) into v_proposed_qty
      from jsonb_array_elements(p_items) as item
      where coalesce(item->>'name','') || '|' || coalesce(nullif(item->>'sale_type',''), 'retail') = v_current_key;

      if v_proposed_qty < v_current_qty then
        v_needs_approval := true;
        exit;
      end if;
    end loop;

    if v_needs_approval then
      insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
      values (
        p_invoice_id,
        'item_change',
        v_user,
        jsonb_build_object(
          'p_invoice_id', p_invoice_id,
          'p_customer_name', p_customer_name,
          'p_customer_phone', p_customer_phone,
          'p_customer_address', p_customer_address,
          'p_status', p_status,
          'p_pay_method', p_pay_method,
          'p_momo_number', p_momo_number,
          'p_notes', p_notes,
          'p_subtotal', p_subtotal,
          'p_total', p_total,
          'p_items', p_items
        )
      );
      return jsonb_build_object('success', true, 'items_pending_approval', true);
    end if;
  end if;

  update invoices set
    customer_name    = coalesce(p_customer_name,    customer_name),
    customer_phone   = coalesce(p_customer_phone,   customer_phone),
    customer_address = coalesce(p_customer_address, customer_address),
    status           = case when p_status is not null then p_status::invoice_status else status end,
    pay_method       = case
                         when p_status = 'paid' and p_pay_method is not null then p_pay_method::payment_method
                         when p_status = 'paid' and p_pay_method is null then null
                         else pay_method
                       end,
    momo_number      = case when p_status = 'paid' then p_momo_number else momo_number end,
    notes            = coalesce(p_notes,    notes),
    subtotal         = coalesce(p_subtotal, subtotal),
    total            = coalesce(p_total,    total),
    updated_at       = now()
  where id = p_invoice_id;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    delete from invoice_items where invoice_id = p_invoice_id;
    insert into invoice_items (invoice_id, name, qty, price, sale_type)
    select
      p_invoice_id,
      (item->>'name')::text,
      (item->>'qty')::integer,
      (item->>'price')::numeric,
      coalesce(nullif(item->>'sale_type', ''), 'retail')
    from jsonb_array_elements(p_items) as item
    where (item->>'name') is not null and (item->>'name') <> '';
  end if;

  select row_to_json(i)::jsonb into v_invoice from invoices i where i.id = p_invoice_id;
  select jsonb_agg(row_to_json(ii)) into v_items from invoice_items ii where ii.invoice_id = p_invoice_id;

  return jsonb_build_object('invoice', v_invoice, 'items', coalesce(v_items, '[]'::jsonb), 'success', true);
end;
$$;

create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set last_login = now()
  where id = auth.uid();
end;
$$;

create or replace function public.record_partial_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text default null,
  p_momo_number text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_new_paid numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status public.invoice_status;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and deleted = false
  for update;

  if not found then raise exception 'Invoice not found'; end if;
  if not public.can_access_location(v_invoice.location) then raise exception 'Access denied'; end if;

  v_new_paid := least(coalesce(v_invoice.amount_paid, 0) + p_amount, v_invoice.total);
  v_new_balance := greatest(v_invoice.total - v_new_paid, 0);
  v_new_status := case when v_new_balance = 0 then 'paid'::public.invoice_status else 'partial'::public.invoice_status end;

  insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
  values (p_invoice_id, p_amount, p_method, nullif(trim(coalesce(p_momo_number, '')), ''), nullif(trim(coalesce(p_note, '')), ''), v_user);

  update public.invoices
  set amount_paid = v_new_paid,
      balance = v_new_balance,
      status = v_new_status,
      partial_method = p_method,
      partial_momo_number = nullif(trim(coalesce(p_momo_number, '')), '')
  where id = p_invoice_id;

  return jsonb_build_object(
    'new_paid', v_new_paid,
    'new_balance', v_new_balance,
    'new_status', v_new_status
  );
end;
$$;

create or replace function public.approve_invoice_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_request public.invoice_edit_requests%rowtype;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role from public.profiles where id = v_user and active = true;
  if not found or v_role <> 'admin' then
    raise exception 'Only an admin can approve requests';
  end if;

  select * into v_request from public.invoice_edit_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'Request has already been reviewed'; end if;

  if v_request.request_type = 'discount' then
    select public.create_invoice_no_stock(
      p_customer_name    => v_request.payload->>'p_customer_name',
      p_location         => (v_request.payload->>'p_location')::public.branch_location,
      p_items            => v_request.payload->'p_items',
      p_customer_phone   => v_request.payload->>'p_customer_phone',
      p_customer_address => v_request.payload->>'p_customer_address',
      p_status           => coalesce((v_request.payload->>'p_status')::public.invoice_status, 'pending'),
      p_pay_method       => nullif(v_request.payload->>'p_pay_method','')::public.payment_method,
      p_momo_number      => v_request.payload->>'p_momo_number',
      p_notes            => v_request.payload->>'p_notes',
      p_amount_paid      => coalesce((v_request.payload->>'p_amount_paid')::numeric, 0),
      p_discount         => coalesce((v_request.payload->>'p_discount')::numeric, 0),
      p_partial_method   => v_request.payload->>'p_partial_method',
      p_partial_momo     => v_request.payload->>'p_partial_momo',
      p_is_cash_sale     => coalesce((v_request.payload->>'p_is_cash_sale')::boolean, false),
      p_cash_tendered    => nullif(v_request.payload->>'p_cash_tendered','')::numeric
    ) into v_result;

  elsif v_request.request_type = 'item_change' then
    select public.update_invoice_no_stock(
      p_invoice_id       => v_request.invoice_id,
      p_customer_name    => v_request.payload->>'p_customer_name',
      p_customer_phone   => v_request.payload->>'p_customer_phone',
      p_customer_address => v_request.payload->>'p_customer_address',
      p_status           => v_request.payload->>'p_status',
      p_pay_method       => v_request.payload->>'p_pay_method',
      p_momo_number      => v_request.payload->>'p_momo_number',
      p_notes            => v_request.payload->>'p_notes',
      p_subtotal         => nullif(v_request.payload->>'p_subtotal','')::numeric,
      p_total            => nullif(v_request.payload->>'p_total','')::numeric,
      p_items            => v_request.payload->'p_items'
    ) into v_result;
  else
    raise exception 'Unknown request type';
  end if;

  update public.invoice_edit_requests
  set status = 'approved', reviewed_by = v_user, reviewed_at = now()
  where id = p_request_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Request Approved', v_request.request_type || ' request approved', v_user);

  return v_result;
end;
$$;

create or replace function public.reject_invoice_request(p_request_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_request public.invoice_edit_requests%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role from public.profiles where id = v_user and active = true;
  if not found or v_role <> 'admin' then
    raise exception 'Only an admin can reject requests';
  end if;

  select * into v_request from public.invoice_edit_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'Request has already been reviewed'; end if;

  update public.invoice_edit_requests
  set status = 'rejected', reviewed_by = v_user, reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Request Rejected', v_request.request_type || ' request rejected' || coalesce(': ' || p_reason, ''), v_user);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.soft_delete_invoice_no_stock(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can delete invoices';
  end if;

  select *
    into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.deleted then
    return;
  end if;

  update public.invoices
  set deleted = true,
      deleted_by = v_user,
      deleted_at = now()
  where id = p_invoice_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Deleted (no stock)', 'Invoice ' || v_invoice.number || ' deleted (stock not restored)', v_user);
end;
$$;

create or replace function public.soft_delete_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_item public.invoice_items%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can delete invoices';
  end if;

  select *
    into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.deleted then
    return;
  end if;

  for v_item in
    select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_invoice.location = 'Alabar' then
      update public.products
      set stock_alabar = stock_alabar + v_item.qty
      where id = v_item.product_id;
    else
      update public.products
      set stock_morocco = stock_morocco + v_item.qty
      where id = v_item.product_id;
    end if;

    insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
    values (v_item.product_id, v_item.name, v_invoice.location, v_item.qty, 'Return', 'Invoice ' || v_invoice.number || ' deleted', v_user);
  end loop;

  update public.invoices
  set deleted = true,
      deleted_by = v_user,
      deleted_at = now()
  where id = p_invoice_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Deleted', 'Invoice ' || v_invoice.number || ' deleted and stock restored', v_user);
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.stock_history enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id or public.is_admin());

drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "products_select_authenticated" on public.products;
create policy "products_select_authenticated"
on public.products for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write"
on public.products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "customers_select_by_location" on public.customers;
create policy "customers_select_by_location"
on public.customers for select
to authenticated
using (public.can_access_location(location));

drop policy if exists "customers_insert_by_location" on public.customers;
create policy "customers_insert_by_location"
on public.customers for insert
to authenticated
with check ((select auth.uid()) = created_by and public.can_access_location(location));

drop policy if exists "customers_update_by_location" on public.customers;
create policy "customers_update_by_location"
on public.customers for update
to authenticated
using (public.can_access_location(location))
with check (public.can_access_location(location));

drop policy if exists "customers_delete_admin" on public.customers;
create policy "customers_delete_admin"
on public.customers for delete
to authenticated
using (public.is_admin());

drop policy if exists "invoices_select_by_location" on public.invoices;
create policy "invoices_select_by_location"
on public.invoices for select
to authenticated
using (public.can_access_location(location));

drop policy if exists "invoices_insert_own_location" on public.invoices;

drop policy if exists "invoices_admin_update" on public.invoices;
create policy "invoices_admin_update"
on public.invoices for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invoice_items_select_parent_location" on public.invoice_items;
create policy "invoice_items_select_parent_location"
on public.invoice_items for select
to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id and public.can_access_location(i.location)
  )
);

drop policy if exists "invoice_items_insert_parent_allowed" on public.invoice_items;

drop policy if exists "invoice_items_admin_update_delete" on public.invoice_items;
drop policy if exists "invoice_items_admin_update" on public.invoice_items;
create policy "invoice_items_admin_update"
on public.invoice_items for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invoice_items_admin_delete" on public.invoice_items;
create policy "invoice_items_admin_delete"
on public.invoice_items for delete
to authenticated
using (public.is_admin())
;

create or replace view public.sales_summary
with (security_invoker = true)
as
select
  location,
  date_trunc('day', created_at) as day,
  sum(total) as total_sales,
  count(*) as invoice_count
from public.invoices
where deleted = false
group by location, date_trunc('day', created_at);

create or replace view public.outstanding_balances
with (security_invoker = true)
as
select id, number, customer_name, customer_phone, location, total, amount_paid, balance, created_at
from public.invoices
where deleted = false and balance > 0;

create or replace view public.product_sales_summary
with (security_invoker = true)
as
select
  ii.name as product_name,
  ii.product_id,
  i.location,
  date_trunc('day', i.created_at) as sale_day,
  date_trunc('week', i.created_at) as sale_week,
  date_trunc('month', i.created_at) as sale_month,
  sum(ii.qty) as qty_sold,
  ii.price as unit_price,
  sum(ii.qty::numeric * ii.price) as revenue
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id
where i.deleted = false
group by ii.name, ii.product_id, i.location, date_trunc('day', i.created_at), date_trunc('week', i.created_at), date_trunc('month', i.created_at), ii.price;

drop policy if exists "invoice_payments_select" on public.invoice_payments;
create policy "invoice_payments_select"
on public.invoice_payments for select
to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_payments.invoice_id
      and public.can_access_location(i.location)
      and (i.deleted = false or public.is_admin())
      and (public.is_admin() or i.created_by = (select auth.uid()))
  )
);

drop policy if exists "invoice_payments_insert" on public.invoice_payments;
create policy "invoice_payments_insert"
on public.invoice_payments for insert
to authenticated
with check (true);

drop policy if exists "invoice_payments_update" on public.invoice_payments;
create policy "invoice_payments_update"
on public.invoice_payments for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invoice_edit_requests_select" on public.invoice_edit_requests;
create policy "invoice_edit_requests_select"
on public.invoice_edit_requests for select
to authenticated
using (public.is_admin() or requested_by = (select auth.uid()));

drop policy if exists "invoice_edit_requests_insert" on public.invoice_edit_requests;
create policy "invoice_edit_requests_insert"
on public.invoice_edit_requests for insert
to authenticated
with check (requested_by = (select auth.uid()));

drop policy if exists "invoice_edit_requests_update" on public.invoice_edit_requests;
create policy "invoice_edit_requests_update"
on public.invoice_edit_requests for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

alter table public.invoice_payments enable row level security;
alter table public.invoice_edit_requests enable row level security;

drop policy if exists "stock_history_select_by_location" on public.stock_history;
create policy "stock_history_select_by_location"
on public.stock_history for select
to authenticated
using (public.can_access_location(location));

drop policy if exists "stock_history_insert_by_location" on public.stock_history;
create policy "stock_history_insert_by_location"
on public.stock_history for insert
to authenticated
with check ((select auth.uid()) = created_by and public.can_access_location(location));

drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin"
on public.audit_logs for select
to authenticated
using (public.is_admin());

drop policy if exists "audit_logs_insert_authenticated" on public.audit_logs;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, update on public.invoices to authenticated;
grant select, update, delete on public.invoice_items to authenticated;
grant select on public.stock_history to authenticated;
grant select on public.audit_logs to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.invoice_payments to authenticated;
grant select, insert, update on public.invoice_edit_requests to authenticated;
grant all on all tables in schema public to service_role;
revoke all on sequence public.invoice_number_seq from public, anon, authenticated;
revoke execute on function public.current_profile_role() from public;
revoke execute on function public.current_profile_location() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.can_access_location(public.branch_location) from public;
revoke execute on function public.complete_password_change() from public;
revoke execute on function public.complete_staff_tour() from public;
revoke execute on function public.any_admin_exists() from public;
revoke execute on function public.bootstrap_first_admin(uuid, text, text, text) from public;
revoke execute on function public.generate_product_sku(text) from public;
revoke execute on function public.import_products(jsonb, text, text, integer, boolean) from public;
revoke execute on function public.generate_invoice_number() from public, anon, authenticated;
revoke execute on function public.create_invoice(text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text) from public;
revoke execute on function public.soft_delete_invoice(uuid) from public;
revoke execute on function public.soft_delete_invoice_no_stock(uuid) from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_location() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_location(public.branch_location) to authenticated;
grant execute on function public.complete_password_change() to authenticated;
grant execute on function public.complete_staff_tour() to authenticated;
grant execute on function public.any_admin_exists() to anon, authenticated, service_role;
grant execute on function public.bootstrap_first_admin(uuid, text, text, text) to service_role;
grant execute on function public.generate_product_sku(text) to authenticated;
grant execute on function public.import_products(jsonb, text, text, integer, boolean) to authenticated;
grant execute on function public.log_audit(text, text) to authenticated;
grant execute on function public.create_invoice(text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text) to authenticated;
grant execute on function public.soft_delete_invoice(uuid) to authenticated;
grant execute on function public.soft_delete_invoice_no_stock(uuid) to authenticated;
grant select on public.sales_summary to authenticated;
grant select on public.outstanding_balances to authenticated;
grant select on public.product_sales_summary to authenticated;

-- create_invoice_no_stock / update_invoice_no_stock / record_login /
-- approve_invoice_request / reject_invoice_request are, on the live project,
-- also granted to `anon`/PUBLIC (Postgres's default for a newly created
-- SECURITY DEFINER function, never explicitly revoked here). Each function
-- still requires `auth.uid()` to resolve, which anon calls can't provide, so
-- this isn't currently exploitable — captured as-is (baseline sync) rather
-- than tightened, since that's a behavior change beyond "match live."
grant execute on function public.create_invoice_no_stock(text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric) to anon, authenticated;
grant execute on function public.update_invoice_no_stock(uuid, text, text, text, text, text, text, text, numeric, numeric, jsonb) to anon, authenticated;
grant execute on function public.record_login() to anon, authenticated;
grant execute on function public.record_partial_payment(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.approve_invoice_request(uuid) to anon, authenticated;
grant execute on function public.reject_invoice_request(uuid, text) to anon, authenticated;

insert into public.products (name, sku, category, price, stock_alabar, stock_morocco, reorder_level)
values
  ('1.5l water jug 6027', 'LMD-15L-WATER-JUG-6027', 'General', 32, 0, 0, 5),
  ('116 strainer', 'LMD-116-STRAINER', 'General', 6.5, 0, 0, 5),
  ('116 strainer small', 'LMD-116-STRAINER-SMALL', 'General', 5.5, 0, 0, 5),
  ('116-1 strainer', 'LMD-116-1-STRAINER', 'General', 8.5, 0, 0, 5),
  ('11pcs measuring spoons', 'LMD-11PCS-MEASURING-SPOONS', 'General', 10, 0, 0, 5),
  ('12" oval plate ggk', 'LMD-12-OVAL-PLATE-GGK', 'General', 21, 0, 0, 5),
  ('133 Tablespoon', 'LMD-133-TABLESPOON', 'General', 8, 0, 0, 5),
  ('148 strainer', 'LMD-148-STRAINER', 'General', 9.5, 0, 0, 5),
  ('18cm metal sieve', 'LMD-18CM-METAL-SIEVE', 'General', 12.5, 0, 0, 5),
  ('20 pcs biscuit cutter', 'LMD-20-PCS-BISCUIT-CUTTER', 'General', 18, 0, 0, 5),
  ('20 pcs dinner set', 'LMD-20-PCS-DINNER-SET', 'General', 215, 0, 0, 5),
  ('22cm metal sieve', 'LMD-22CM-METAL-SIEVE', 'General', 15, 0, 0, 5),
  ('24*34 wooden board s/s', 'LMD-24-34-WOODEN-BOARD-S-S', 'General', 28, 0, 0, 5),
  ('24cm metal sieve', 'LMD-24CM-METAL-SIEVE', 'General', 16, 0, 0, 5),
  ('28*36 wooden board b/s', 'LMD-28-36-WOODEN-BOARD-B-S', 'General', 33, 0, 0, 5),
  ('3080cc', 'LMD-3080CC', 'General', 240, 0, 0, 5),
  ('3081cc', 'LMD-3081CC', 'General', 260, 0, 0, 5),
  ('30cm food cover', 'LMD-30CM-FOOD-COVER', 'General', 12, 0, 0, 5),
  ('34cm rose frying pan', 'LMD-34CM-ROSE-FRYING-PAN', 'General', 95, 0, 0, 5),
  ('35cm food cover', 'LMD-35CM-FOOD-COVER', 'General', 15, 0, 0, 5),
  ('36cm rose frying pan', 'LMD-36CM-ROSE-FRYING-PAN', 'General', 105, 0, 0, 5),
  ('3pcs measuring cup', 'LMD-3PCS-MEASURING-CUP', 'General', 19, 0, 0, 5),
  ('4 pcs cutlery ( colours)', 'LMD-4-PCS-CUTLERY-COLOURS', 'General', 8, 0, 0, 5),
  ('4 pcs cutlery (metal)', 'LMD-4-PCS-CUTLERY-METAL', 'General', 7, 0, 0, 5),
  ('4 pcs wooden spoon', 'LMD-4-PCS-WOODEN-SPOON', 'General', 8.5, 0, 0, 5),
  ('425-17 tray', 'LMD-425-17-TRAY', 'General', 22, 0, 0, 5),
  ('425-19 tray', 'LMD-425-19-TRAY', 'General', 30, 0, 0, 5),
  ('425-21 tray', 'LMD-425-21-TRAY', 'General', 35, 0, 0, 5),
  ('42cm plate rack', 'LMD-42CM-PLATE-RACK', 'General', 90, 0, 0, 5),
  ('5 pcs glass bowl', 'LMD-5-PCS-GLASS-BOWL', 'General', 28, 0, 0, 5),
  ('5 pcs pie cutters', 'LMD-5-PCS-PIE-CUTTERS', 'General', 24, 0, 0, 5),
  ('52cm plate rack', 'LMD-52CM-PLATE-RACK', 'General', 100, 0, 0, 5),
  ('5kg scale', 'LMD-5KG-SCALE', 'General', 32, 0, 0, 5),
  ('6 pcs ice cream glass', 'LMD-6-PCS-ICE-CREAM-GLASS', 'General', 32, 0, 0, 5),
  ('8 pcs cake decorating set', 'LMD-8-PCS-CAKE-DECORATING-SET', 'General', 15, 0, 0, 5),
  ('8" metal knife', 'LMD-8-METAL-KNIFE', 'General', 15.5, 0, 0, 5),
  ('9" metal knife', 'LMD-9-METAL-KNIFE', 'General', 16, 0, 0, 5),
  ('Butcher knife CG050', 'LMD-BUTCHER-KNIFE-CG050', 'General', 50, 0, 0, 5),
  ('Fruit basket', 'LMD-FRUIT-BASKET', 'General', 20, 0, 0, 5),
  ('Grater bowl s/s', 'LMD-GRATER-BOWL-S-S', 'General', 10, 0, 0, 5),
  ('Grater stand G41 b/s', 'LMD-GRATER-STAND-G41-B-S', 'General', 10, 0, 0, 5),
  ('Grater stand G41 s/s', 'LMD-GRATER-STAND-G41-S-S', 'General', 9, 0, 0, 5),
  ('Grater stand G61 b/s', 'LMD-GRATER-STAND-G61-B-S', 'General', 19, 0, 0, 5),
  ('Grater stand G61 sides s/s', 'LMD-GRATER-STAND-G61-SIDES-S-S', 'General', 17, 0, 0, 5),
  ('Grater stand plastic', 'LMD-GRATER-STAND-PLASTIC', 'General', 9, 0, 0, 5),
  ('HK-09 knife', 'LMD-HK-09-KNIFE', 'General', 14.5, 0, 0, 5),
  ('HK-10 knife', 'LMD-HK-10-KNIFE', 'General', 15, 0, 0, 5),
  ('JB 824 plate rack', 'LMD-JB-824-PLATE-RACK', 'General', 30, 0, 0, 5),
  ('K45 knife', 'LMD-K45-KNIFE', 'General', 8, 0, 0, 5),
  ('K46 knife', 'LMD-K46-KNIFE', 'General', 8.5, 0, 0, 5),
  ('Lunch box 4 set', 'LMD-LUNCH-BOX-4-SET', 'General', 100, 0, 0, 5),
  ('Mug M01', 'LMD-MUG-M01', 'General', 13, 0, 0, 5),
  ('Orange squeezer', 'LMD-ORANGE-SQUEEZER', 'General', 34, 0, 0, 5),
  ('Orgas abidjan', 'LMD-ORGAS-ABIDJAN', 'General', 14, 0, 0, 5),
  ('Palette knife', 'LMD-PALETTE-KNIFE', 'General', 11, 0, 0, 5),
  ('Palette knife (offset)', 'LMD-PALETTE-KNIFE-OFFSET', 'General', 11, 0, 0, 5),
  ('Roumezi knife s/s', 'LMD-ROUMEZI-KNIFE-S-S', 'General', 14.5, 0, 0, 5),
  ('Sinboss kettle 4L', 'LMD-SINBOSS-KETTLE-4L', 'General', 150, 0, 0, 5),
  ('Turner A01', 'LMD-TURNER-A01', 'General', 7.5, 0, 0, 5),
  ('Water jug 0.6l ( no box)', 'LMD-WATER-JUG-06L-NO-BOX', 'General', 15, 0, 0, 5),
  ('Water jug 1L', 'LMD-WATER-JUG-1L', 'General', 25, 0, 0, 5),
  ('bread knife ord', 'LMD-BREAD-KNIFE-ORD', 'General', 4.5, 0, 0, 5),
  ('ladle A01', 'LMD-LADLE-A01', 'General', 7.5, 0, 0, 5),
  ('ladle A03', 'LMD-LADLE-A03', 'General', 9, 0, 0, 5),
  ('mini knife with cover', 'LMD-MINI-KNIFE-WITH-COVER', 'General', 3, 0, 0, 5),
  ('plantain knife s/s', 'LMD-PLANTAIN-KNIFE-S-S', 'General', 7, 0, 0, 5),
  ('plastic board m/s', 'LMD-PLASTIC-BOARD-M-S', 'General', 23, 0, 0, 5),
  ('plastic board s/s', 'LMD-PLASTIC-BOARD-S-S', 'General', 15, 0, 0, 5)
on conflict (sku) do update
set name = excluded.name,
    category = excluded.category,
    price = excluded.price,
    reorder_level = excluded.reorder_level;

-- Business Settings — single-row table of business-wide config (name,
-- contact info, currency symbol, default reorder level, brand accent
-- colour), added directly on the live project after this file was first
-- written. Read by every staff account; only admins can change it.
create table if not exists public.business_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default '',
  phone text not null default '',
  address text not null default '',
  currency_symbol text not null default 'GH₵',
  default_reorder_level integer not null default 10,
  brand_color text not null default '#5C2D0A',
  logo_url text,
  onboarding_completed boolean not null default false,
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

grant select, insert, update on public.business_settings to authenticated;

insert into public.business_settings (id)
values (1)
on conflict (id) do nothing;

-- Onboarding: a one-time business-setup wizard for the first admin, and a
-- one-time feature tour for new staff. Existing rows are backfilled to
-- "already seen" so current users aren't shown either unexpectedly; only a
-- blank business_settings row or a profile created after this point stays
-- unseen.
update public.business_settings set onboarding_completed = true
  where trim(coalesce(business_name, '')) <> '';
update public.profiles set has_seen_tour = true;

-- Personal "land here after login" preference, one column on profiles
-- (nullable — falls back to a role-based default when unset).
alter table public.profiles add column if not exists default_landing_page text;

-- Storage bucket for the uploaded business logo. Public read (the login
-- screen shows it before anyone is authenticated); only admins can upload,
-- replace, or remove it.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "branding_admin_insert" on storage.objects;
create policy "branding_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_update" on storage.objects;
create policy "branding_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_delete" on storage.objects;
create policy "branding_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'branding' and public.is_admin());

do $$
declare
  v_admin_id uuid;
  v_product_id uuid;
  v_invoice_id uuid := '2c1d4a7d-25f2-4d49-8d68-6f27dd0c6001';
  v_item_id uuid := '2c1d4a7d-25f2-4d49-8d68-6f27dd0c6002';
  v_audit_id uuid := '2c1d4a7d-25f2-4d49-8d68-6f27dd0c6003';
begin
  select id into v_admin_id
  from public.profiles
  where role = 'admin'
  order by created_at asc
  limit 1;

  select id into v_product_id
  from public.products
  where sku = 'LMD-15L-WATER-JUG-6027'
  limit 1;

  if v_admin_id is null or v_product_id is null then
    return;
  end if;

  insert into public.invoices (
    id,
    number,
    customer_name,
    customer_phone,
    customer_address,
    location,
    total,
    status,
    pay_method,
    momo_number,
    notes,
    created_by,
    deleted,
    created_at,
    updated_at
  )
  values (
    v_invoice_id,
    'SEED-000001',
    'RLS Smoke Test Customer',
    null,
    null,
    'Alabar',
    32,
    'paid',
    'cash',
    null,
    'Seeded for RLS smoke testing',
    v_admin_id,
    false,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.invoice_items (
    id,
    invoice_id,
    product_id,
    name,
    qty,
    price
  )
  values (
    v_item_id,
    v_invoice_id,
    v_product_id,
    '1.5l water jug 6027',
    1,
    32
  )
  on conflict (id) do nothing;

  insert into public.audit_logs (
    id,
    action,
    detail,
    created_by,
    created_at
  )
  values (
    v_audit_id,
    'Seed Data Loaded',
    'Seeded one audit row and one invoice row for RLS smoke testing',
    v_admin_id,
    now()
  )
  on conflict (id) do nothing;
end $$;

-- Admin Profile Setup
-- Update admin email if admin profile already exists
update public.profiles
set email = 'admin@lumoda.org'
where username = 'admin';

-- Optional: If creating admin fresh, uncomment and customize with UUID from Supabase Auth Dashboard:
-- insert into public.profiles (id, username, full_name, role, location, active, email)
-- values (
--   'YOUR-ADMIN-UUID-FROM-AUTH',
--   'admin',
--   'System Administrator',
--   'admin',
--   'All',
--   true,
--   'admin@lumoda.org'
-- )
-- on conflict (id) do update
-- set username = excluded.username,
--     full_name = excluded.full_name,
--     role = excluded.role,
--     location = excluded.location,
--     active = excluded.active,
--     email = excluded.email;

-- ============================================================
-- 20260805110000 / 20260805111500 / 20260805112000 — codebase-review fixes:
-- close two live permission gaps, drop two now-fully-dead invoice
-- functions, and make manual stock adjustment atomic.
-- ============================================================

-- invoice_payments_insert was `with check (true)` — any authenticated staff
-- login could insert a payment row against ANY invoice, any branch, any
-- amount, directly via the client SDK. The app never needs this: every real
-- payment write goes through record_partial_payment() or the initial
-- payment insert inside create_invoice_no_stock(), both security definer
-- functions that don't need this grant/policy to keep working.
revoke insert on public.invoice_payments from authenticated;

drop policy if exists "invoice_payments_insert" on public.invoice_payments;
create policy "invoice_payments_insert"
on public.invoice_payments for insert
to authenticated
with check (false);

-- create_invoice and soft_delete_invoice (the original, stock-aware
-- versions) have zero callers — only their _no_stock successors are ever
-- called. Stock enforcement on sale was reviewed and explicitly left as-is,
-- so these aren't needed as a reference either. Dropped.
drop function if exists public.create_invoice(
  text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text
);
drop function if exists public.soft_delete_invoice(uuid);

-- applyStockAdjustment() used to read the cached stock value, compute a new
-- absolute number client-side, and write it back via a plain upsert plus a
-- separate fire-and-forget stock_history insert — two concurrent
-- adjustments could both read the same stale value and the second write
-- would silently clobber the first. This function does the read-check-write
-- and the stock_history insert together, atomically, row-locked,
-- server-side.
create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_location public.branch_location,
  p_delta integer,
  p_type text default 'Correction',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_new_stock integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can adjust stock';
  end if;

  if p_location not in ('Alabar', 'Morocco') then
    raise exception 'Invalid location';
  end if;

  if p_delta = 0 then
    raise exception 'Adjustment quantity must not be zero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if p_location = 'Alabar' then
    v_new_stock := v_product.stock_alabar + p_delta;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock';
    end if;
    update public.products set stock_alabar = v_new_stock, updated_at = now() where id = p_product_id;
  else
    v_new_stock := v_product.stock_morocco + p_delta;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock';
    end if;
    update public.products set stock_morocco = v_new_stock, updated_at = now() where id = p_product_id;
  end if;

  insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
  values (
    p_product_id, v_product.name, p_location, p_delta,
    coalesce(nullif(trim(coalesce(p_type, '')), ''), 'Correction'),
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Manual ' || coalesce(p_type, 'adjustment')),
    v_user
  );

  return jsonb_build_object(
    'success', true,
    'stock_alabar', case when p_location = 'Alabar' then v_new_stock else v_product.stock_alabar end,
    'stock_morocco', case when p_location = 'Morocco' then v_new_stock else v_product.stock_morocco end
  );
end;
$$;

revoke execute on function public.adjust_product_stock(uuid, public.branch_location, integer, text, text) from public, anon;
grant execute on function public.adjust_product_stock(uuid, public.branch_location, integer, text, text) to authenticated;

-- ============================================================
-- 20260812045845 — offline cash sales: idempotent create_invoice_no_stock.
-- Staff app now queues a cash sale locally when the network fails mid-
-- checkout and retries it once the connection returns. A retry has to be
-- safe to send twice (a sync can succeed on the server but the confirmation
-- never reach the client), so a client-generated client_ref is now
-- accepted and, if it's already attached to an invoice, that invoice is
-- returned instead of a new one being created.
-- ============================================================

alter table public.invoices add column if not exists client_ref text;
create unique index if not exists invoices_client_ref_uidx
  on public.invoices(client_ref) where client_ref is not null;

-- Adding a parameter via bare "create or replace" would leave the old
-- 15-arg signature callable as a second, un-idempotent overload (the same
-- dangling-overload trap fixed earlier this project), so it's dropped
-- explicitly first before the 16-arg version (below) is created.
drop function if exists public.create_invoice_no_stock(
  text, public.branch_location, jsonb, text, text, public.invoice_status,
  public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric
);

create or replace function public.create_invoice_no_stock(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null,
  p_amount_paid numeric default 0,
  p_discount numeric default 0,
  p_partial_method text default null,
  p_partial_momo text default null,
  p_is_cash_sale boolean default false,
  p_cash_tendered numeric default null,
  p_client_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_id uuid;
  v_number text;
  v_customer_id uuid;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_effective_paid numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric(12,2);
  v_sale_type text;
  v_existing public.invoices%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  -- Idempotent replay: if this exact client_ref already produced an
  -- invoice, hand back that invoice instead of creating a second one.
  if p_client_ref is not null then
    select * into v_existing from public.invoices where client_ref = p_client_ref;
    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'number', v_existing.number,
        'subtotal', v_existing.subtotal,
        'discount', v_existing.discount,
        'total', v_existing.total,
        'paid', v_existing.amount_paid,
        'balance', v_existing.balance,
        'idempotent_replay', true
      );
    end if;
  end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;
  if p_location not in ('Alabar', 'Morocco') then raise exception 'Invalid invoice location'; end if;
  if v_role <> 'admin' and p_location <> v_user_location then raise exception 'You cannot create invoices for this branch'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Invoice requires at least one item'; end if;
  if p_status = 'paid' and p_pay_method is null then raise exception 'Payment method is required for paid invoices'; end if;

  -- Any discount from a non-admin is held for approval instead of applied.
  -- Nothing is created yet — the customer record, invoice, and items are
  -- only produced once an admin approves the request (approve_invoice_request).
  -- This branch doesn't create an invoice row, so the client_ref check above
  -- can't catch a retry here — checked separately against any still-pending
  -- request carrying the same client_ref, so a retried offline sale with a
  -- discount doesn't queue a second approval request for the same sale.
  if v_role <> 'admin' and coalesce(p_discount, 0) > 0 then
    if p_client_ref is not null and exists (
      select 1 from public.invoice_edit_requests
      where status = 'pending' and payload->>'p_client_ref' = p_client_ref
    ) then
      return jsonb_build_object('success', true, 'discount_pending_approval', true, 'idempotent_replay', true);
    end if;

    insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
    values (
      null,
      'discount',
      v_user,
      jsonb_build_object(
        'p_customer_name', p_customer_name,
        'p_location', p_location,
        'p_items', p_items,
        'p_customer_phone', p_customer_phone,
        'p_customer_address', p_customer_address,
        'p_status', p_status,
        'p_pay_method', p_pay_method,
        'p_momo_number', p_momo_number,
        'p_notes', p_notes,
        'p_amount_paid', p_amount_paid,
        'p_discount', p_discount,
        'p_partial_method', p_partial_method,
        'p_partial_momo', p_partial_momo,
        'p_is_cash_sale', p_is_cash_sale,
        'p_cash_tendered', p_cash_tendered,
        'p_client_ref', p_client_ref
      )
    );
    return jsonb_build_object('success', true, 'discount_pending_approval', true);
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  select id into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_address, '')), ''),
      p_location,
      v_user
    ) returning id into v_customer_id;
  else
    update public.customers
    set phone = coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), phone),
        address = coalesce(nullif(trim(coalesce(p_customer_address, '')), ''), address)
    where id = v_customer_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);

    if v_item_name = '' then raise exception 'Item name is required'; end if;
    if v_item_qty < 1 then raise exception 'Quantity must be greater than zero'; end if;
    if v_item_price < 0 then raise exception 'Price cannot be negative'; end if;

    v_subtotal := v_subtotal + (v_item_qty * v_item_price);
  end loop;

  if v_subtotal <= 0 then raise exception 'Invoice total must be greater than zero'; end if;

  v_total := greatest(v_subtotal - coalesce(p_discount, 0), 0);

  v_effective_paid := case
    when p_status = 'paid' then v_total
    when p_status = 'partial' then least(greatest(coalesce(p_amount_paid, 0), 0), v_total)
    else 0
  end;

  insert into public.invoices (
    customer_id, customer_name, customer_phone, customer_address,
    location, subtotal, discount, total, status, pay_method, momo_number, notes,
    amount_paid, balance, partial_method, partial_momo_number, is_cash_sale, cash_tendered, created_by,
    client_ref
  ) values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    v_subtotal,
    coalesce(p_discount, 0),
    v_total,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_effective_paid,
    greatest(v_total - v_effective_paid, 0),
    p_partial_method,
    nullif(trim(coalesce(p_partial_momo, '')), ''),
    coalesce(p_is_cash_sale, false),
    p_cash_tendered,
    v_user,
    p_client_ref
  ) returning id, number into v_invoice_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);
    v_sale_type := coalesce(nullif(v_item->>'sale_type', ''), nullif(v_item->>'priceType', ''), 'retail');
    v_product_id := null;

    if nullif(v_item->>'product_id', '') is not null and v_item->>'product_id' <> 'null' then
      select id into v_product_id
      from public.products
      where id = (v_item->>'product_id')::uuid
      limit 1;
    end if;

    if v_product_id is null then
      select id into v_product_id
      from public.products
      where lower(name) = lower(v_item_name)
      limit 1;
    end if;

    insert into public.invoice_items (invoice_id, product_id, name, sale_type, qty, price)
    values (v_invoice_id, v_product_id, v_item_name, v_sale_type, v_item_qty, v_item_price);
  end loop;

  if v_effective_paid > 0 then
    insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
    values (
      v_invoice_id,
      v_effective_paid,
      coalesce(p_pay_method::text, p_partial_method),
      coalesce(p_momo_number, p_partial_momo),
      'Initial payment',
      v_user
    );
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || v_number || ' created for ' || trim(p_customer_name), v_user);

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'number', v_number,
    'subtotal', v_subtotal,
    'discount', coalesce(p_discount, 0),
    'total', v_total,
    'paid', v_effective_paid,
    'balance', greatest(v_total - v_effective_paid, 0)
  );
end;
$$;

-- Matches the anon+authenticated grant the original 15-arg signature had —
-- harmless for anon since the function itself rejects a null auth.uid().
grant execute on function public.create_invoice_no_stock(
  text, public.branch_location, jsonb, text, text, public.invoice_status,
  public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric, text
) to anon, authenticated;
-- LUMODA ENTERPRISE Warehouse schema
-- Run this separately after the core schema in supabase-schema.sql.
-- Dependencies: auth.users, public.audit_logs, and the core product/profile tables.
--
-- Baseline sync note: this file previously described a `warehouse_products`
-- shape (a `code` column, no stock tracking) and a `warehouse_movements`
-- shape (description required, no approval workflow) that no longer matches
-- what has been running live for some time. Rewritten below to match the
-- live project exactly, plus the tables/functions that existed live but were
-- never captured here at all (warehouse_stock_balance, warehouse_stock_journal,
-- post_warehouse_movement_direct, approve_warehouse_movement).

create table if not exists public.warehouse_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text,
  cartons integer not null default 0,
  reorder_level integer not null default 0,
  created_at timestamptz not null default now()
);

-- Legacy/unused: referenced only by warehouse_movements.supplier_id below,
-- which itself is not written to by any current code path (the app records
-- supplier as free text on the movement, and uses public.warehouse_suppliers
-- for the supplier directory). Kept only so that FK resolves; currently empty.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  contact_person text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.warehouse_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  location text,
  notes text,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- product_id/quantity/supplier_id/branch_location/note are an earlier, no
-- longer written-to shape, superseded by the items/jsonb + status/approval
-- columns below. Kept (nullable) for backward compatibility with any old rows.
create table if not exists public.warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.warehouse_products(id) on delete cascade,
  type text not null check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment')),
  quantity integer,
  supplier_id uuid references public.suppliers(id),
  branch_location text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  rejection_reason text,
  description text,
  cartons integer not null default 0 check (cartons >= 0),
  items jsonb not null default '[]'::jsonb,
  requisition_no text,
  issue_to text,
  storekeeper text,
  supplier text,
  notes text,
  created_by_name text
);

create table if not exists public.warehouse_requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_no text not null unique,
  issue_to text not null,
  storekeeper text not null,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.warehouse_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.warehouse_requisitions(id) on delete cascade,
  product_id uuid references public.warehouse_products(id),
  description text not null,
  cartons integer not null default 0 check (cartons >= 0),
  quantity_supplied integer not null default 0 check (quantity_supplied >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

-- Server-authoritative stock ledger, keyed by item_code (not product_id — the
-- app matches on the free-text code/description it also stores on movements).
-- See WAREHOUSE_V2_PLAN.md for the design this implements.
create table if not exists public.warehouse_stock_balance (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  total_cartons integer not null default 0 check (total_cartons >= 0),
  reserved_cartons integer not null default 0 check (reserved_cartons >= 0),
  available_cartons integer generated always as (total_cartons - reserved_cartons) stored,
  reorder_level integer not null default 10,
  last_movement_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit trail of every balance-affecting change, one row per item per
-- movement. Not currently written to by post_warehouse_movement_direct /
-- approve_warehouse_movement below (present live, unused so far) — kept here
-- so the table exists for when that's wired up, per WAREHOUSE_V2_PLAN.md.
create table if not exists public.warehouse_stock_journal (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid references public.warehouse_movements(id) on delete cascade,
  item_code text not null,
  item_name text not null,
  movement_type text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment')),
  cartons_before integer not null,
  cartons_delta integer not null,
  cartons_after integer not null,
  balance_before integer not null,
  balance_after integer not null,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_products_name_idx on public.warehouse_products(name);
create index if not exists warehouse_products_created_at_idx on public.warehouse_products(created_at desc);
create index if not exists warehouse_suppliers_created_at_idx on public.warehouse_suppliers(created_at desc);
create index if not exists warehouse_movements_created_at_idx on public.warehouse_movements(created_at desc);
create index if not exists warehouse_movements_type_idx on public.warehouse_movements(type);
create index if not exists warehouse_requisitions_created_at_idx on public.warehouse_requisitions(created_at desc);
create index if not exists warehouse_requisition_items_requisition_id_idx on public.warehouse_requisition_items(requisition_id);
create index if not exists warehouse_stock_balance_item_code_idx on public.warehouse_stock_balance(item_code);
create index if not exists warehouse_stock_balance_updated_at_idx on public.warehouse_stock_balance(updated_at desc);
create index if not exists warehouse_stock_journal_movement_id_idx on public.warehouse_stock_journal(movement_id);
create index if not exists warehouse_stock_journal_item_code_idx on public.warehouse_stock_journal(item_code);
create index if not exists warehouse_stock_journal_created_at_idx on public.warehouse_stock_journal(created_at desc);

-- Records a stock movement server-side: validates role, validates available
-- balance before a stock_out (row-locked to prevent a double-oversell race),
-- and inserts/updates warehouse_stock_balance. stock_in/opening_balance/
-- adjustment post immediately (status 'executed'); stock_out is left
-- 'pending' — cartons are reserved, not yet deducted — until an admin calls
-- approve_warehouse_movement below.
create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  insert into public.warehouse_movements (
    type, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    case when p_type in ('stock_in', 'opening_balance', 'adjustment') then 'executed' else 'pending' end,
    case when p_type in ('stock_in', 'opening_balance', 'adjustment') then now() else null end
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      update public.warehouse_stock_balance
      set reserved_cartons = reserved_cartons + v_cartons,
          updated_at = now()
      where item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

-- Admin-only. Finalizes a pending stock_out: on approval, deducts the
-- reserved cartons from total_cartons; on rejection, releases the reservation
-- without touching total_cartons.
create or replace function public.approve_warehouse_movement(
  p_movement_id uuid,
  p_approved boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_movement record;
  v_item jsonb;
  v_item_code text;
  v_cartons integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'admin' and active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Only admin can approve');
  end if;

  select * into v_movement
  from public.warehouse_movements
  where id = p_movement_id
  for update;

  if v_movement.id is null then
    return jsonb_build_object('success', false, 'error', 'Movement not found');
  end if;

  if v_movement.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'This movement was already ' || v_movement.status);
  end if;

  if p_approved = true then
    update public.warehouse_movements
    set status = 'executed', approved_by = v_user_id, approved_at = now(), executed_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set total_cartons = total_cartons - v_cartons,
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where item_code = v_item_code;
      end loop;
    end if;
  else
    update public.warehouse_movements
    set status = 'rejected', rejection_reason = p_rejection_reason, approved_by = v_user_id, approved_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where item_code = v_item_code;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

alter table public.warehouse_products enable row level security;
alter table public.warehouse_suppliers enable row level security;
alter table public.warehouse_movements enable row level security;
alter table public.warehouse_requisitions enable row level security;
alter table public.warehouse_requisition_items enable row level security;
alter table public.warehouse_stock_balance enable row level security;
alter table public.warehouse_stock_journal enable row level security;

-- Baseline sync note: every policy below is currently `true` on the live
-- project — i.e. there is no real row-level access control on warehouse data
-- today, only frontend menu-hiding (any authenticated user can read/write
-- these tables directly via the API). Captured as-is here because that's
-- what's actually live; Milestone 1 of the multi-warehouse migration
-- replaces these with real per-warehouse checks.
-- Read/add/edit stay open to any authenticated staff (the catalog is
-- shared across every warehouse); delete is admin-only.
drop policy if exists "warehouse_products_all" on public.warehouse_products;
drop policy if exists "warehouse_products_select" on public.warehouse_products;
create policy "warehouse_products_select" on public.warehouse_products for select to authenticated using (true);
drop policy if exists "warehouse_products_insert" on public.warehouse_products;
create policy "warehouse_products_insert" on public.warehouse_products for insert to authenticated with check (true);
drop policy if exists "warehouse_products_update" on public.warehouse_products;
create policy "warehouse_products_update" on public.warehouse_products for update to authenticated using (true) with check (true);
drop policy if exists "warehouse_products_delete" on public.warehouse_products;
create policy "warehouse_products_delete" on public.warehouse_products for delete to authenticated using (public.is_admin());

drop policy if exists "warehouse_suppliers_all" on public.warehouse_suppliers;
create policy "warehouse_suppliers_all" on public.warehouse_suppliers for all to authenticated using (true) with check (true);

drop policy if exists "warehouse_movements_select" on public.warehouse_movements;
create policy "warehouse_movements_select" on public.warehouse_movements for select to authenticated using (true);
drop policy if exists "warehouse_movements_insert" on public.warehouse_movements;
create policy "warehouse_movements_insert" on public.warehouse_movements for insert to authenticated with check (true);
drop policy if exists "warehouse_movements_update" on public.warehouse_movements;
create policy "warehouse_movements_update" on public.warehouse_movements for update to authenticated using (true) with check (true);
drop policy if exists "warehouse_movements_delete" on public.warehouse_movements;
create policy "warehouse_movements_delete" on public.warehouse_movements for delete to authenticated using (true);

drop policy if exists "warehouse_requisitions_all" on public.warehouse_requisitions;
create policy "warehouse_requisitions_all" on public.warehouse_requisitions for all to authenticated using (true) with check (true);

drop policy if exists "warehouse_requisition_items_all" on public.warehouse_requisition_items;
create policy "warehouse_requisition_items_all" on public.warehouse_requisition_items for all to authenticated using (true) with check (true);

drop policy if exists "warehouse_stock_balance_select" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_select" on public.warehouse_stock_balance for select to authenticated using (true);
drop policy if exists "warehouse_stock_balance_insert" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_insert" on public.warehouse_stock_balance for insert to authenticated with check (true);
drop policy if exists "warehouse_stock_balance_update" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_update" on public.warehouse_stock_balance for update to authenticated using (true) with check (true);

drop policy if exists "warehouse_stock_journal_all" on public.warehouse_stock_journal;
create policy "warehouse_stock_journal_all" on public.warehouse_stock_journal for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.warehouse_products to authenticated;
grant select, insert, update, delete on public.warehouse_suppliers to authenticated;
grant select, insert, update, delete on public.warehouse_movements to authenticated;
grant select, insert, update, delete on public.warehouse_requisitions to authenticated;
grant select, insert, update, delete on public.warehouse_requisition_items to authenticated;
grant select, insert, update on public.warehouse_stock_balance to authenticated;
grant select, insert, update, delete on public.warehouse_stock_journal to authenticated;
grant select on public.suppliers to authenticated;

grant execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.approve_warehouse_movement(uuid, boolean, text) to anon, authenticated;

-- ============================================================
-- Multi-warehouse (Milestone 1) — applied via
-- supabase/migrations/20260802174352_multi_warehouse_m1.sql
-- ============================================================

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists warehouses_touch_updated_at on public.warehouses;
create trigger warehouses_touch_updated_at before update on public.warehouses
for each row execute function public.touch_updated_at();

create table if not exists public.warehouse_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, warehouse_id)
);

alter table public.warehouse_stock_balance add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_requisitions add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_stock_journal add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements add column if not exists to_warehouse_id uuid references public.warehouses(id);

alter table public.warehouse_movements drop constraint if exists warehouse_movements_type_check;
alter table public.warehouse_movements add constraint warehouse_movements_type_check
  check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment', 'transfer'));

-- On a fresh environment these NOT NULL/unique changes apply immediately
-- since there's no pre-existing data to backfill first; on the live project
-- this was done as backfill-then-tighten (see the migration file above).
alter table public.warehouse_stock_balance alter column warehouse_id set not null;
alter table public.warehouse_movements alter column warehouse_id set not null;
alter table public.warehouse_requisitions alter column warehouse_id set not null;
alter table public.warehouse_stock_journal alter column warehouse_id set not null;

alter table public.warehouse_stock_balance drop constraint if exists warehouse_stock_balance_item_code_key;
alter table public.warehouse_stock_balance add constraint warehouse_stock_balance_warehouse_item_key unique (warehouse_id, item_code);

create index if not exists warehouse_stock_balance_warehouse_id_idx on public.warehouse_stock_balance(warehouse_id);
create index if not exists warehouse_movements_warehouse_id_idx on public.warehouse_movements(warehouse_id);
create index if not exists warehouse_requisitions_warehouse_id_idx on public.warehouse_requisitions(warehouse_id);
create index if not exists warehouse_stock_journal_warehouse_id_idx on public.warehouse_stock_journal(warehouse_id);

create or replace function public.can_access_warehouse(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
      select 1 from public.warehouse_staff_assignments wsa
      where wsa.warehouse_id = target_warehouse_id
        and wsa.profile_id = (select auth.uid())
    ),
    false
  )
$$;

revoke execute on function public.can_access_warehouse(uuid) from public;
grant execute on function public.can_access_warehouse(uuid) to authenticated;

alter table public.warehouses enable row level security;
alter table public.warehouse_staff_assignments enable row level security;

drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated
  using (public.is_admin() or public.can_access_warehouse(id));
drop policy if exists "warehouses_admin_write" on public.warehouses;
create policy "warehouses_admin_write" on public.warehouses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "warehouse_staff_assignments_select" on public.warehouse_staff_assignments;
create policy "warehouse_staff_assignments_select" on public.warehouse_staff_assignments for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
drop policy if exists "warehouse_staff_assignments_admin_write" on public.warehouse_staff_assignments;
create policy "warehouse_staff_assignments_admin_write" on public.warehouse_staff_assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Replaces the wide-open `true` policies above for these four tables now
-- that warehouse_id exists — real per-warehouse access control.
drop policy if exists "warehouse_stock_balance_select" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_select" on public.warehouse_stock_balance for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_stock_balance_insert" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_insert" on public.warehouse_stock_balance for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_stock_balance_update" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_update" on public.warehouse_stock_balance for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));

drop policy if exists "warehouse_movements_select" on public.warehouse_movements;
create policy "warehouse_movements_select" on public.warehouse_movements for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_insert" on public.warehouse_movements;
create policy "warehouse_movements_insert" on public.warehouse_movements for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_update" on public.warehouse_movements;
create policy "warehouse_movements_update" on public.warehouse_movements for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_delete" on public.warehouse_movements;
create policy "warehouse_movements_delete" on public.warehouse_movements for delete to authenticated
  using (public.is_admin());

drop policy if exists "warehouse_requisitions_all" on public.warehouse_requisitions;
create policy "warehouse_requisitions_select" on public.warehouse_requisitions for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy "warehouse_requisitions_insert" on public.warehouse_requisitions for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
create policy "warehouse_requisitions_update" on public.warehouse_requisitions for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));

drop policy if exists "warehouse_stock_journal_all" on public.warehouse_stock_journal;
create policy "warehouse_stock_journal_select" on public.warehouse_stock_journal for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy "warehouse_stock_journal_insert" on public.warehouse_stock_journal for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));

-- warehouse_products/warehouse_suppliers deliberately stay on their existing
-- `true` policies — the product catalog is shared/global across all
-- warehouses, per the client's explicit requirement.

grant select, insert, update on public.warehouses to authenticated;
grant select on public.warehouse_staff_assignments to authenticated;

-- Replaces the post_warehouse_movement_direct definition earlier in this
-- file — same logic, now warehouse-scoped. p_warehouse_id defaults to null
-- and is resolved to the "MAIN" warehouse inside the function body (Postgres
-- doesn't allow a subquery in a parameter DEFAULT), so callers that don't
-- pass it yet keep working.
create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  -- Every movement type auto-executes immediately — Stock Out used to be
  -- saved as 'pending' expecting a separate approval step, but nothing in
  -- the frontend ever called approve_warehouse_movement, so Stock Out was
  -- permanently stuck pending and totals never actually decreased. Since
  -- the admin isn't always reachable to approve in real time, the fix is
  -- to remove the gate rather than build a UI around it — the balance
  -- check above still blocks overselling, and the audit trail (who did
  -- what, when) covers accountability instead of a real-time approval.
  insert into public.warehouse_movements (
    type, warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    'executed', now()
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      -- Deduct straight from total_cartons now that this executes
      -- immediately (previously only touched reserved_cartons, which is
      -- why totals never reflected stock that had actually left).
      update public.warehouse_stock_balance
      set total_cartons = total_cartons - v_cartons,
          last_movement_at = now(),
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) to authenticated;

-- Replaces approve_warehouse_movement earlier in this file — signature is
-- unchanged (it reads warehouse_id off the movement row it's approving), but
-- its stock_out balance update is now warehouse-scoped.
create or replace function public.approve_warehouse_movement(
  p_movement_id uuid,
  p_approved boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_movement record;
  v_item jsonb;
  v_item_code text;
  v_cartons integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'admin' and active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Only admin can approve');
  end if;

  select * into v_movement
  from public.warehouse_movements
  where id = p_movement_id
  for update;

  if v_movement.id is null then
    return jsonb_build_object('success', false, 'error', 'Movement not found');
  end if;

  if v_movement.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'This movement was already ' || v_movement.status);
  end if;

  if p_approved = true then
    update public.warehouse_movements
    set status = 'executed', approved_by = v_user_id, approved_at = now(), executed_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set total_cartons = total_cartons - v_cartons,
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where warehouse_id = v_movement.warehouse_id and item_code = v_item_code;
      end loop;
    end if;
  else
    update public.warehouse_movements
    set status = 'rejected', rejection_reason = p_rejection_reason, approved_by = v_user_id, approved_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where warehouse_id = v_movement.warehouse_id and item_code = v_item_code;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ============================================================
-- 20260805100000 / 20260805101500 / 20260805103000 — supplier UI backend
-- fixes, dead approval-flow removal, and warehouse-to-warehouse transfers.
-- ============================================================

-- approve_warehouse_movement (defined above) was the other half of the
-- "pending approval" flow that the auto-execute change above already
-- disabled. Nothing in the frontend calls this RPC, and no movement can be
-- left in a state it would ever act on — every insert path sets
-- status = 'executed' directly (confirmed live: zero pending/rejected rows
-- exist). Dropped outright.
drop function if exists public.approve_warehouse_movement(uuid, boolean, text);

-- Also discovered live at this point: a THIRD copy of
-- post_warehouse_movement_direct had survived from before multi-warehouse
-- support — a 10-arg version with no p_warehouse_id and no
-- can_access_warehouse() check at all, using the original pending-approval /
-- reserved_cartons-only stock_out logic. It was never cleaned up when the
-- 11-arg version was introduced (that migration used CREATE OR REPLACE
-- without first dropping the old signature — the exact overload trap called
-- out below). The live app never called it (supabase-client.js always sends
-- p_warehouse_id), but it was reachable by anyone calling the RPC directly,
-- bypassing per-warehouse authorization entirely. Dropped.
drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text
);

-- Wires up the `transfer` movement type and `to_warehouse_id` column added
-- (but never used) in the multi-warehouse migration — moves stock between
-- two warehouses in a single transaction/movement row instead of a manual
-- stock_out + stock_in pair. Permission model mirrors stock_out: only the
-- SOURCE warehouse requires can_access_warehouse() — destination access is
-- deliberately not required, same as how Stock In already lets a manager
-- receive goods without a destination-specific gate. Stays auto-executing,
-- like every other movement type, because the admin is frequently
-- unreachable.
--
-- Must drop the 11-arg signature explicitly before creating the new 12-arg
-- one — CREATE OR REPLACE only replaces a function whose parameter *types*
-- match exactly; adding a trailing parameter would otherwise create a
-- second overload (the same trap the stray 10-arg function above came
-- from), and PostgREST would fail to pick an overload on any call that
-- omits p_to_warehouse_id.
drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid
);

create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null,
  p_to_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment', 'transfer') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type <> 'transfer' then
    p_to_warehouse_id := null; -- ignore a stray value on non-transfer calls
  end if;

  if p_type = 'transfer' then
    if p_to_warehouse_id is null then
      return jsonb_build_object('success', false, 'error', 'Destination warehouse is required');
    end if;
    if p_to_warehouse_id = p_warehouse_id then
      return jsonb_build_object('success', false, 'error', 'Source and destination warehouse must be different');
    end if;
    if not exists (select 1 from public.warehouses where id = p_to_warehouse_id and active = true) then
      return jsonb_build_object('success', false, 'error', 'Destination warehouse not found or inactive');
    end if;
  end if;

  if p_type in ('stock_out', 'transfer') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  insert into public.warehouse_movements (
    type, warehouse_id, to_warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_to_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    'executed', now()
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type in ('stock_out', 'transfer') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      update public.warehouse_stock_balance
      set total_cartons = total_cartons - v_cartons,
          last_movement_at = now(),
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  if p_type = 'transfer' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_to_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid, uuid
) to authenticated;

-- warehouses is a small shared directory (id/code/name/address/active), not
-- sensitive stock or staff data — that stays properly gated by
-- can_access_warehouse() on warehouse_stock_balance/warehouse_movements/etc.
-- A warehouse_manager needs to see every warehouse's name to pick a transfer
-- destination they don't otherwise have access to (deliberate — see above),
-- so the previous can_access_warehouse()-gated select policy (defined
-- earlier in this file) is too narrow. Mirrors the existing shared-catalog
-- model already used for warehouse_products/warehouse_suppliers.
drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated using (true);
-- warehouses_admin_write (insert/update/delete), defined earlier in this
-- file, is unchanged — admin-only.

-- ============================================================
-- 20260805110000 / 20260805113000 — codebase-review fixes: close the
-- warehouse_products/warehouse_suppliers write-access gap, and link the
-- product/warehouse catalogs.
-- ============================================================

-- warehouse_products/warehouse_suppliers insert/update (and suppliers'
-- delete) were `using (true)` — any authenticated staff account, including
-- a plain branch cashier with zero warehouse involvement, could write to
-- the shared warehouse catalog directly. Read stays open (harmless, shared
-- catalog); writes now require admin or warehouse_manager.
drop policy if exists "warehouse_products_insert" on public.warehouse_products;
create policy "warehouse_products_insert" on public.warehouse_products for insert to authenticated
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));

drop policy if exists "warehouse_products_update" on public.warehouse_products;
create policy "warehouse_products_update" on public.warehouse_products for update to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'))
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));

drop policy if exists "warehouse_suppliers_all" on public.warehouse_suppliers;
create policy "warehouse_suppliers_select" on public.warehouse_suppliers for select to authenticated using (true);
create policy "warehouse_suppliers_insert" on public.warehouse_suppliers for insert to authenticated
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));
create policy "warehouse_suppliers_update" on public.warehouse_suppliers for update to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'))
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));
create policy "warehouse_suppliers_delete" on public.warehouse_suppliers for delete to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'));

-- Products and warehouse items were two fully independent catalogs — 310
-- warehouse items, 417 branch products, zero matching SKUs, even though
-- many represent the same real product under a different code. Going
-- forward, this trigger keeps warehouse_products in sync automatically,
-- one direction only (products -> warehouse): a product row requires a
-- price, which a warehouse-only item may not have yet, so auto-creating a
-- full sellable product from a warehouse-side add isn't safe to automate.
create or replace function public.sync_product_to_warehouse_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sku is null or trim(new.sku) = '' then
    return new;
  end if;

  insert into public.warehouse_products (sku, name, category, reorder_level)
  values (new.sku, new.name, coalesce(new.category, 'General'), coalesce(new.reorder_level, 10))
  on conflict (sku) do update set
    name = excluded.name,
    category = excluded.category,
    reorder_level = excluded.reorder_level;

  return new;
end;
$$;

drop trigger if exists products_sync_warehouse_catalog on public.products;
create trigger products_sync_warehouse_catalog
  after insert or update of name, sku, category, reorder_level on public.products
  for each row execute function public.sync_product_to_warehouse_catalog();

-- Existing mismatch: reconciled via the app's "Link to Warehouse Catalog"
-- screen (admin-only, Products page), which proposes name-matched pairs for
-- a human to confirm or skip. link_catalog_item() is what a confirmed pair
-- calls: the warehouse item takes on the product's sku/name/category/
-- reorder_level (product is canonical going forward), and every existing
-- warehouse_stock_balance row (in every warehouse) keyed to the item's OLD
-- sku is renamed to the new shared sku, so live stock tracking doesn't
-- silently disconnect from the catalog entry it belongs to. Historical
-- warehouse_movements rows are left untouched (point-in-time snapshots,
-- same as invoice line items already snapshot product names/prices).
create or replace function public.link_catalog_item(
  p_product_id uuid,
  p_warehouse_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_wh_product public.warehouse_products%rowtype;
  v_old_sku text;
begin
  if not public.is_admin() then
    raise exception 'Only admin can link catalog items';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  if v_product.sku is null or trim(v_product.sku) = '' then
    raise exception 'This product has no SKU to link with';
  end if;

  select * into v_wh_product from public.warehouse_products where id = p_warehouse_product_id for update;
  if not found then raise exception 'Warehouse item not found'; end if;

  v_old_sku := v_wh_product.sku;

  update public.warehouse_products
  set sku = v_product.sku,
      name = v_product.name,
      category = coalesce(v_product.category, 'General'),
      reorder_level = coalesce(v_product.reorder_level, reorder_level)
  where id = p_warehouse_product_id;

  if v_old_sku is not null and v_old_sku <> v_product.sku then
    update public.warehouse_stock_balance
    set item_code = v_product.sku,
        item_name = v_product.name,
        updated_at = now()
    where item_code = v_old_sku;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- Bulk "create the rest" step in the reconciliation screen — creates a
-- warehouse catalog entry for every product that still doesn't have one
-- after the manual review pass.
create or replace function public.backfill_warehouse_catalog_from_products()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admin can backfill the warehouse catalog';
  end if;

  with missing as (
    select p.sku, p.name, p.category, p.reorder_level
    from public.products p
    where p.sku is not null and trim(p.sku) <> ''
      and not exists (
        select 1 from public.warehouse_products wp where wp.sku = p.sku
      )
  )
  insert into public.warehouse_products (sku, name, category, reorder_level)
  select sku, name, coalesce(category, 'General'), coalesce(reorder_level, 10) from missing;

  get diagnostics v_count = row_count;

  return jsonb_build_object('success', true, 'created', v_count);
end;
$$;

revoke execute on function public.link_catalog_item(uuid, uuid) from public, anon;
grant execute on function public.link_catalog_item(uuid, uuid) to authenticated;
revoke execute on function public.backfill_warehouse_catalog_from_products() from public, anon;
grant execute on function public.backfill_warehouse_catalog_from_products() to authenticated;
-- Milestone 1: multi-warehouse infrastructure
--
-- Non-destructive: every column is added nullable first, backfilled to a
-- single "Main Warehouse" representing all of today's existing warehouse
-- data, then tightened to NOT NULL. Nothing existing is deleted or renamed.
-- The 4 additional warehouses are intentionally NOT created here — only the
-- infrastructure to add them (via the new admin "Warehouses" page) once real
-- names/locations are provided.
--
-- Backward compatibility: post_warehouse_movement_direct's new p_warehouse_id
-- parameter defaults to Main Warehouse, so the *currently deployed* frontend
-- (which doesn't send it yet) keeps working exactly as before until the
-- updated app/warehouse.js is deployed alongside this migration.

-- 1. Warehouses
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists warehouses_touch_updated_at on public.warehouses;
create trigger warehouses_touch_updated_at before update on public.warehouses
for each row execute function public.touch_updated_at();

insert into public.warehouses (code, name, address, active)
values ('MAIN', 'Main Warehouse', null, true)
on conflict (code) do nothing;

-- 2. Staff <-> warehouse assignment (many-to-many; admins implicitly have
-- access to every warehouse via can_access_warehouse() below, so they don't
-- need rows here)
create table if not exists public.warehouse_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, warehouse_id)
);

-- Assign every current admin/warehouse_manager to Main Warehouse so nobody
-- who could act on warehouse data yesterday is locked out today.
insert into public.warehouse_staff_assignments (profile_id, warehouse_id)
select p.id, w.id
from public.profiles p, public.warehouses w
where p.role in ('admin', 'warehouse_manager') and w.code = 'MAIN'
on conflict (profile_id, warehouse_id) do nothing;

-- 3. warehouse_id on every existing warehouse table (nullable first)
alter table public.warehouse_stock_balance add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_requisitions add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_stock_journal add column if not exists warehouse_id uuid references public.warehouses(id);

-- Optional inter-warehouse transfer support (design-now, build-later — see
-- WAREHOUSE_V2_PLAN.md-style approach): a stock_out can either go to
-- to_warehouse_id (internal transfer) or, from Milestone 2 on, to a retail
-- branch via destination_location. Not exercised by any code path yet.
alter table public.warehouse_movements add column if not exists to_warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements drop constraint if exists warehouse_movements_type_check;
alter table public.warehouse_movements add constraint warehouse_movements_type_check
  check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment', 'transfer'));

-- 4. Backfill: every existing row belongs to Main Warehouse
update public.warehouse_stock_balance set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;
update public.warehouse_movements set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;
update public.warehouse_requisitions set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;
update public.warehouse_stock_journal set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;

-- 5. Tighten to NOT NULL now that every row has a value
alter table public.warehouse_stock_balance alter column warehouse_id set not null;
alter table public.warehouse_movements alter column warehouse_id set not null;
alter table public.warehouse_requisitions alter column warehouse_id set not null;
alter table public.warehouse_stock_journal alter column warehouse_id set not null;

-- 6. Uniqueness moves from item_code alone to (warehouse_id, item_code) —
-- this is the change that actually makes stock per-warehouse instead of global.
alter table public.warehouse_stock_balance drop constraint if exists warehouse_stock_balance_item_code_key;
alter table public.warehouse_stock_balance add constraint warehouse_stock_balance_warehouse_item_key unique (warehouse_id, item_code);

create index if not exists warehouse_stock_balance_warehouse_id_idx on public.warehouse_stock_balance(warehouse_id);
create index if not exists warehouse_movements_warehouse_id_idx on public.warehouse_movements(warehouse_id);
create index if not exists warehouse_requisitions_warehouse_id_idx on public.warehouse_requisitions(warehouse_id);
create index if not exists warehouse_stock_journal_warehouse_id_idx on public.warehouse_stock_journal(warehouse_id);

-- 7. Access control: same shape as the existing can_access_location()
create or replace function public.can_access_warehouse(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
      select 1 from public.warehouse_staff_assignments wsa
      where wsa.warehouse_id = target_warehouse_id
        and wsa.profile_id = (select auth.uid())
    ),
    false
  )
$$;

revoke execute on function public.can_access_warehouse(uuid) from public;
grant execute on function public.can_access_warehouse(uuid) to authenticated;

-- 8. Replace the wide-open `true` policies with real per-warehouse checks
alter table public.warehouses enable row level security;
alter table public.warehouse_staff_assignments enable row level security;

drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated
  using (public.is_admin() or public.can_access_warehouse(id));
drop policy if exists "warehouses_admin_write" on public.warehouses;
create policy "warehouses_admin_write" on public.warehouses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "warehouse_staff_assignments_select" on public.warehouse_staff_assignments;
create policy "warehouse_staff_assignments_select" on public.warehouse_staff_assignments for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
drop policy if exists "warehouse_staff_assignments_admin_write" on public.warehouse_staff_assignments;
create policy "warehouse_staff_assignments_admin_write" on public.warehouse_staff_assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "warehouse_stock_balance_select" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_select" on public.warehouse_stock_balance for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_stock_balance_insert" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_insert" on public.warehouse_stock_balance for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_stock_balance_update" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_update" on public.warehouse_stock_balance for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));

drop policy if exists "warehouse_movements_select" on public.warehouse_movements;
create policy "warehouse_movements_select" on public.warehouse_movements for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_insert" on public.warehouse_movements;
create policy "warehouse_movements_insert" on public.warehouse_movements for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_update" on public.warehouse_movements;
create policy "warehouse_movements_update" on public.warehouse_movements for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_delete" on public.warehouse_movements;
create policy "warehouse_movements_delete" on public.warehouse_movements for delete to authenticated
  using (public.is_admin());

drop policy if exists "warehouse_requisitions_all" on public.warehouse_requisitions;
create policy "warehouse_requisitions_select" on public.warehouse_requisitions for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy "warehouse_requisitions_insert" on public.warehouse_requisitions for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
create policy "warehouse_requisitions_update" on public.warehouse_requisitions for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));

drop policy if exists "warehouse_stock_journal_all" on public.warehouse_stock_journal;
create policy "warehouse_stock_journal_select" on public.warehouse_stock_journal for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy "warehouse_stock_journal_insert" on public.warehouse_stock_journal for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));

-- warehouse_products/warehouse_suppliers stay global (shared catalog, per
-- the client's explicit "items should be the same across all 5 warehouses"
-- requirement) — left on their existing `true` policies deliberately, not
-- an oversight.

grant select, insert, update on public.warehouses to authenticated;
grant select on public.warehouse_staff_assignments to authenticated;

-- 9. Make the two movement functions warehouse-aware.
-- p_warehouse_id defaults to null and is resolved to Main Warehouse inside
-- the function body (Postgres doesn't allow a subquery in a parameter
-- DEFAULT expression) — so the currently-deployed frontend, which doesn't
-- send it yet, keeps working unchanged until app/warehouse.js is redeployed
-- with the warehouse selector.
create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  -- Backward compatibility: the currently-deployed frontend doesn't send
  -- p_warehouse_id yet — resolve it to Main Warehouse rather than requiring
  -- every caller to be updated in lockstep with this migration.
  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  insert into public.warehouse_movements (
    type, warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    case when p_type in ('stock_in', 'opening_balance', 'adjustment') then 'executed' else 'pending' end,
    case when p_type in ('stock_in', 'opening_balance', 'adjustment') then now() else null end
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      update public.warehouse_stock_balance
      set reserved_cartons = reserved_cartons + v_cartons,
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) to authenticated;

-- approve_warehouse_movement doesn't need a new parameter — it already reads
-- the movement's own row (which now carries warehouse_id), so scoping its
-- balance update by warehouse_id is enough; the signature is unchanged, so
-- this is a pure behind-the-scenes fix, nothing to coordinate with the frontend.
create or replace function public.approve_warehouse_movement(
  p_movement_id uuid,
  p_approved boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_movement record;
  v_item jsonb;
  v_item_code text;
  v_cartons integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'admin' and active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Only admin can approve');
  end if;

  select * into v_movement
  from public.warehouse_movements
  where id = p_movement_id
  for update;

  if v_movement.id is null then
    return jsonb_build_object('success', false, 'error', 'Movement not found');
  end if;

  if v_movement.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'This movement was already ' || v_movement.status);
  end if;

  if p_approved = true then
    update public.warehouse_movements
    set status = 'executed', approved_by = v_user_id, approved_at = now(), executed_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set total_cartons = total_cartons - v_cartons,
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where warehouse_id = v_movement.warehouse_id and item_code = v_item_code;
      end loop;
    end if;
  else
    update public.warehouse_movements
    set status = 'rejected', rejection_reason = p_rejection_reason, approved_by = v_user_id, approved_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where warehouse_id = v_movement.warehouse_id and item_code = v_item_code;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;
-- Only admins can delete warehouse catalog items; any authenticated staff
-- can still read/add/edit them (unchanged from before). Previously the
-- table had a single ALL/true policy, so any authenticated user could
-- delete items via the API even though nothing in the UI exposed it.
begin;

drop policy if exists warehouse_products_all on public.warehouse_products;

create policy warehouse_products_select on public.warehouse_products
  for select to authenticated
  using (true);

create policy warehouse_products_insert on public.warehouse_products
  for insert to authenticated
  with check (true);

create policy warehouse_products_update on public.warehouse_products
  for update to authenticated
  using (true)
  with check (true);

create policy warehouse_products_delete on public.warehouse_products
  for delete to authenticated
  using (public.is_admin());

commit;
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
-- Lets an admin customize the app's primary accent colour (currently a
-- fixed brown everywhere) instead of it being hardcoded.
begin;

alter table public.business_settings add column if not exists brand_color text not null default '#5C2D0A';

commit;
-- Storage bucket for the business logo, uploaded from Business Settings.
-- Public read (the login screen needs to show it before anyone is
-- authenticated); only admins can upload/replace/remove it.
begin;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "branding_admin_insert" on storage.objects;
create policy "branding_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_update" on storage.objects;
create policy "branding_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_delete" on storage.objects;
create policy "branding_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'branding' and public.is_admin());

alter table public.business_settings add column if not exists logo_url text;

commit;
-- One-time reset: Main Warehouse's 311 stock balance rows were backfilled
-- from the old single-inventory system before the multi-warehouse feature
-- existed — not a real current count. The client is starting real
-- warehouse operations this week and wants Main Warehouse to start at
-- zero, the same way an unused warehouse (e.g. OLD TAFO) already shows.
-- Rows are kept (item codes/names/reorder levels intact) and only their
-- quantities are zeroed, so this is reversible if needed. Does not touch
-- public.products (stock_alabar/stock_morocco) — a separate system.
begin;

update public.warehouse_stock_balance
set total_cartons = 0, reserved_cartons = 0, updated_at = now()
where warehouse_id = '10d218f7-1e93-4e6b-9b19-9d369e6ed4f5'; -- Main Warehouse

commit;
-- Stock Out previously saved as status='pending', expecting an approval
-- step (approve_warehouse_movement) that the frontend never actually
-- calls — meaning every Stock Out was stuck "Pending" forever, and
-- total_cartons never decreased (only reserved_cartons went up). The
-- client's admin travels and won't always be reachable to approve
-- anything in real time, so the fix isn't "add an approval screen," it's
-- to auto-execute like every other movement type already does — the
-- balance-sufficiency check stays, and accountability comes from the
-- audit trail (who did what, when) instead of a real-time approval gate.
begin;

create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  -- Every movement type now auto-executes immediately — see comment above.
  insert into public.warehouse_movements (
    type, warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    'executed', now()
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      -- Deduct from total_cartons directly (this used to only touch
      -- reserved_cartons, which is why totals never actually reflected
      -- stock leaving even though "Available" looked correct).
      update public.warehouse_stock_balance
      set total_cartons = total_cartons - v_cartons,
          last_movement_at = now(),
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

commit;
-- approve_warehouse_movement was the other half of the "pending approval"
-- flow that 20260804064003_stock_out_auto_execute.sql already disabled by
-- making every movement type auto-execute. Nothing in the frontend calls
-- this RPC (grep confirms zero callers across app/*.js and app/index.html),
-- and no movement can be left in a state this function would ever act on —
-- every insert path sets status = 'executed' directly, confirmed live (zero
-- pending/rejected rows exist in production). Dropping it removes the last
-- piece of dead approval-flow surface area. The movement.status column, its
-- CHECK constraint, and the approved_by/approved_at/rejection_reason
-- columns are left as-is (harmless, unused) — narrowly scoped;
-- warehouse_requisitions/warehouse_stock_journal are untouched.
begin;

drop function if exists public.approve_warehouse_movement(uuid, boolean, text);

commit;
-- Warehouse-to-warehouse transfers: wires up the `transfer` movement type and
-- `to_warehouse_id` column added (but never used) in
-- 20260802174352_multi_warehouse_m1.sql. One call moves stock between two
-- warehouses in a single transaction/movement row instead of a manual
-- stock_out + stock_in pair (which would create two audit entries and a
-- window where the stock is "in neither warehouse").
--
-- Permission model mirrors stock_out: only the SOURCE warehouse requires
-- can_access_warehouse() (unchanged from the existing p_warehouse_id check)
-- — destination access is deliberately NOT required, same as how Stock In
-- already lets a manager receive goods without a destination-specific gate.
-- Stays auto-executing with no approval step, like every other movement
-- type, because the admin is frequently unreachable.
begin;

-- Must drop the old 11-arg signature explicitly before creating the new
-- 12-arg one — CREATE OR REPLACE only replaces a function whose parameter
-- *types* match exactly. Adding a trailing parameter would otherwise create
-- a second overload, and PostgREST would fail with "could not choose the
-- best candidate function" on every call that omits p_to_warehouse_id (i.e.
-- every existing stock_in/stock_out/opening_balance/adjustment call), since
-- both overloads would match.
drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid
);

create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null,
  p_to_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment', 'transfer') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type <> 'transfer' then
    p_to_warehouse_id := null; -- ignore a stray value on non-transfer calls
  end if;

  if p_type = 'transfer' then
    if p_to_warehouse_id is null then
      return jsonb_build_object('success', false, 'error', 'Destination warehouse is required');
    end if;
    if p_to_warehouse_id = p_warehouse_id then
      return jsonb_build_object('success', false, 'error', 'Source and destination warehouse must be different');
    end if;
    if not exists (select 1 from public.warehouses where id = p_to_warehouse_id and active = true) then
      return jsonb_build_object('success', false, 'error', 'Destination warehouse not found or inactive');
    end if;
  end if;

  if p_type in ('stock_out', 'transfer') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  -- Every movement type auto-executes immediately — see comment above.
  insert into public.warehouse_movements (
    type, warehouse_id, to_warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_to_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    'executed', now()
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type in ('stock_out', 'transfer') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      update public.warehouse_stock_balance
      set total_cartons = total_cartons - v_cartons,
          last_movement_at = now(),
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  if p_type = 'transfer' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_to_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid, uuid
) to authenticated;

-- warehouses is a small shared directory (id/code/name/address/active), not
-- sensitive stock or staff data — that stays properly gated by
-- can_access_warehouse() on warehouse_stock_balance/warehouse_movements/etc.
-- A warehouse_manager needs to see every warehouse's name to pick a transfer
-- destination they don't otherwise have access to (deliberate — see comment
-- above), so the previous can_access_warehouse()-gated select policy is too
-- narrow. Mirrors the existing shared-catalog model already used for
-- warehouse_products/warehouse_suppliers.
drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated using (true);
-- Admin-only write policy on warehouses (insert/update/delete) is unchanged.

commit;
-- Discovered while applying 20260805101500_warehouse_transfers.sql: a THIRD
-- copy of post_warehouse_movement_direct was still live in production — the
-- original 10-arg pre-multi-warehouse version (no p_warehouse_id, no
-- can_access_warehouse() check at all, and the old pending-approval /
-- reserved_cartons-only stock_out logic that 20260804064003 was meant to
-- retire). It survived because the multi-warehouse migration added
-- p_warehouse_id via CREATE OR REPLACE without first dropping the old
-- signature — the exact overload trap this migration's sibling file calls
-- out. In its current form it would actually error on any stock_in/opening/
-- adjustment (its `on conflict (item_code)` no longer matches the table's
-- real `(warehouse_id, item_code)` unique constraint), but a stock_out call
-- would silently succeed while completely bypassing per-warehouse
-- authorization and reintroducing the stuck-forever "pending" bug. The live
-- app was never actually calling this overload (supabase-client.js always
-- sends p_warehouse_id/p_to_warehouse_id now), but it was reachable by
-- anyone calling the RPC directly, so it's dropped outright rather than left
-- as a dangling landmine.
begin;

drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text
);

commit;
-- Codebase review found two real, live permission gaps:
--
-- 1. invoice_payments_insert was `with check (true)` — any authenticated
--    staff login could insert a payment row against ANY invoice, any
--    branch, any amount, directly via the client SDK. The app never
--    actually needs this: every legitimate payment write goes through
--    record_partial_payment() or the initial-payment insert inside
--    create_invoice_no_stock(), both security definer functions that run
--    as the table owner and don't need (or use) this grant/policy to keep
--    working. Locked down to no direct client insert at all.
--
-- 2. warehouse_products/warehouse_suppliers insert/update (and suppliers'
--    delete) were `using (true)` — any authenticated staff account,
--    including a plain branch cashier with zero warehouse involvement,
--    could write to the shared warehouse catalog directly. The UI already
--    hides these actions from non-admin/non-warehouse_manager roles, but
--    nothing enforced it server-side. Read stays open (harmless, shared
--    catalog); writes now require admin or warehouse_manager.
begin;

revoke insert on public.invoice_payments from authenticated;

drop policy if exists "invoice_payments_insert" on public.invoice_payments;
create policy "invoice_payments_insert"
on public.invoice_payments for insert
to authenticated
with check (false);

drop policy if exists "warehouse_products_insert" on public.warehouse_products;
create policy "warehouse_products_insert" on public.warehouse_products for insert to authenticated
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));

drop policy if exists "warehouse_products_update" on public.warehouse_products;
create policy "warehouse_products_update" on public.warehouse_products for update to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'))
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));

drop policy if exists "warehouse_suppliers_all" on public.warehouse_suppliers;
create policy "warehouse_suppliers_select" on public.warehouse_suppliers for select to authenticated using (true);
create policy "warehouse_suppliers_insert" on public.warehouse_suppliers for insert to authenticated
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));
create policy "warehouse_suppliers_update" on public.warehouse_suppliers for update to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'))
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));
create policy "warehouse_suppliers_delete" on public.warehouse_suppliers for delete to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'));

commit;
-- create_invoice and soft_delete_invoice are the original, stock-aware
-- versions of invoice creation/deletion, superseded by create_invoice_no_stock
-- and soft_delete_invoice_no_stock. Confirmed via grep across every client
-- file: zero callers of either. Stock enforcement on sale was reviewed this
-- session and explicitly left as-is (client's call), so these aren't needed
-- as a reference for that either — just dead weight, dropped the same way
-- approve_warehouse_movement was earlier.
begin;

drop function if exists public.create_invoice(
  text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text
);
drop function if exists public.soft_delete_invoice(uuid);

commit;
-- applyStockAdjustment() (app/js/products.js) used to read the cached stock
-- value, compute a new absolute number client-side, and write it back via a
-- plain upsert (saveProduct) plus a separate fire-and-forget stock_history
-- insert — two concurrent adjustments could both read the same stale value
-- and the second write would silently clobber the first, and a failure
-- between the two calls could leave the stock changed with no history row
-- (or vice versa). This function does the read-check-write and the
-- stock_history insert together, atomically, row-locked, server-side.
begin;

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_location public.branch_location,
  p_delta integer,
  p_type text default 'Correction',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_new_stock integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can adjust stock';
  end if;

  if p_location not in ('Alabar', 'Morocco') then
    raise exception 'Invalid location';
  end if;

  if p_delta = 0 then
    raise exception 'Adjustment quantity must not be zero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if p_location = 'Alabar' then
    v_new_stock := v_product.stock_alabar + p_delta;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock';
    end if;
    update public.products set stock_alabar = v_new_stock, updated_at = now() where id = p_product_id;
  else
    v_new_stock := v_product.stock_morocco + p_delta;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock';
    end if;
    update public.products set stock_morocco = v_new_stock, updated_at = now() where id = p_product_id;
  end if;

  insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
  values (
    p_product_id, v_product.name, p_location, p_delta,
    coalesce(nullif(trim(coalesce(p_type, '')), ''), 'Correction'),
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Manual ' || coalesce(p_type, 'adjustment')),
    v_user
  );

  return jsonb_build_object(
    'success', true,
    'stock_alabar', case when p_location = 'Alabar' then v_new_stock else v_product.stock_alabar end,
    'stock_morocco', case when p_location = 'Morocco' then v_new_stock else v_product.stock_morocco end
  );
end;
$$;

revoke execute on function public.adjust_product_stock(uuid, public.branch_location, integer, text, text) from public, anon;
grant execute on function public.adjust_product_stock(uuid, public.branch_location, integer, text, text) to authenticated;

commit;
-- Wires the branch product catalog (`products`) and the warehouse catalog
-- (`warehouse_products`) together. Today they're two fully independent
-- catalogs — 310 warehouse items, 417 branch products, zero matching SKUs —
-- even though many represent the same real product under a different code.
--
-- Going forward: a trigger on `products` keeps `warehouse_products` in sync
-- automatically, one direction only (products -> warehouse). A product row
-- requires a price; a warehouse-only item may not have one yet, so the
-- reverse direction (auto-creating a full sellable product from a
-- warehouse-side add) isn't safe to automate — that stays a manual choice.
--
-- Existing mismatch: reconciled via the app's new "Link to Warehouse
-- Catalog" screen (admin-only), which proposes name-matched pairs for a
-- human to confirm or skip — not an unattended auto-merge, since two
-- different real items can easily share a similar name. link_catalog_item()
-- is what a confirmed pair actually calls; backfill_warehouse_catalog_from_products()
-- is the follow-up bulk action for whatever's left unmatched afterward.
begin;

-- ============================================================
-- 1. Forward sync trigger (products -> warehouse_products)
-- ============================================================
create or replace function public.sync_product_to_warehouse_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sku is null or trim(new.sku) = '' then
    return new;
  end if;

  insert into public.warehouse_products (sku, name, category, reorder_level)
  values (new.sku, new.name, coalesce(new.category, 'General'), coalesce(new.reorder_level, 10))
  on conflict (sku) do update set
    name = excluded.name,
    category = excluded.category,
    reorder_level = excluded.reorder_level;

  return new;
end;
$$;

drop trigger if exists products_sync_warehouse_catalog on public.products;
create trigger products_sync_warehouse_catalog
  after insert or update of name, sku, category, reorder_level on public.products
  for each row execute function public.sync_product_to_warehouse_catalog();

-- ============================================================
-- 2. One-time reconciliation helpers (admin-only)
-- ============================================================

-- Confirms a proposed pair from the reconciliation screen: the warehouse
-- item takes on the product's sku/name/category/reorder_level (product is
-- canonical going forward), and every existing warehouse_stock_balance row
-- (in every warehouse) that was keyed to the item's OLD sku is renamed to
-- the new shared sku, so live stock tracking doesn't silently disconnect
-- from the catalog entry it belongs to. Historical warehouse_movements
-- rows are left untouched — they're point-in-time snapshots, same as
-- invoice line items already snapshot product names/prices.
create or replace function public.link_catalog_item(
  p_product_id uuid,
  p_warehouse_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_wh_product public.warehouse_products%rowtype;
  v_old_sku text;
begin
  if not public.is_admin() then
    raise exception 'Only admin can link catalog items';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  if v_product.sku is null or trim(v_product.sku) = '' then
    raise exception 'This product has no SKU to link with';
  end if;

  select * into v_wh_product from public.warehouse_products where id = p_warehouse_product_id for update;
  if not found then raise exception 'Warehouse item not found'; end if;

  v_old_sku := v_wh_product.sku;

  update public.warehouse_products
  set sku = v_product.sku,
      name = v_product.name,
      category = coalesce(v_product.category, 'General'),
      reorder_level = coalesce(v_product.reorder_level, reorder_level)
  where id = p_warehouse_product_id;

  if v_old_sku is not null and v_old_sku <> v_product.sku then
    update public.warehouse_stock_balance
    set item_code = v_product.sku,
        item_name = v_product.name,
        updated_at = now()
    where item_code = v_old_sku;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- Creates a warehouse catalog entry for every product that still doesn't
-- have one after the manual review pass — the bulk "create the rest" step
-- in the reconciliation screen.
create or replace function public.backfill_warehouse_catalog_from_products()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admin can backfill the warehouse catalog';
  end if;

  with missing as (
    select p.sku, p.name, p.category, p.reorder_level
    from public.products p
    where p.sku is not null and trim(p.sku) <> ''
      and not exists (
        select 1 from public.warehouse_products wp where wp.sku = p.sku
      )
  )
  insert into public.warehouse_products (sku, name, category, reorder_level)
  select sku, name, coalesce(category, 'General'), coalesce(reorder_level, 10) from missing;

  get diagnostics v_count = row_count;

  return jsonb_build_object('success', true, 'created', v_count);
end;
$$;

revoke execute on function public.link_catalog_item(uuid, uuid) from public, anon;
grant execute on function public.link_catalog_item(uuid, uuid) to authenticated;
revoke execute on function public.backfill_warehouse_catalog_from_products() from public, anon;
grant execute on function public.backfill_warehouse_catalog_from_products() to authenticated;

commit;
-- Found while testing 20260805113000: if a product had already been saved
-- at least once since the sync trigger went live, it already has its own
-- auto-created warehouse_products row under its real sku — so the OLD,
-- pre-existing warehouse row (the one with real accumulated stock, sitting
-- under the legacy mismatched code) is a second, separate row with the same
-- name. The original link_catalog_item() just renamed the old row's sku to
-- match the product — which would hit the warehouse_products.sku unique
-- constraint and fail, since a row with that sku already exists.
--
-- Fixed to upsert the canonical row (same logic the trigger uses) instead
-- of blindly renaming the target, move any stock off the old code onto the
-- canonical sku either way, and only delete the old row if it turned out to
-- be a genuine duplicate of the canonical one (not the same row).
begin;

create or replace function public.link_catalog_item(
  p_product_id uuid,
  p_warehouse_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_wh_product public.warehouse_products%rowtype;
  v_canonical_id uuid;
  v_old_sku text;
begin
  if not public.is_admin() then
    raise exception 'Only admin can link catalog items';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  if v_product.sku is null or trim(v_product.sku) = '' then
    raise exception 'This product has no SKU to link with';
  end if;

  select * into v_wh_product from public.warehouse_products where id = p_warehouse_product_id for update;
  if not found then raise exception 'Warehouse item not found'; end if;

  v_old_sku := v_wh_product.sku;

  insert into public.warehouse_products (sku, name, category, reorder_level)
  values (v_product.sku, v_product.name, coalesce(v_product.category, 'General'), coalesce(v_product.reorder_level, 10))
  on conflict (sku) do update set
    name = excluded.name,
    category = excluded.category,
    reorder_level = excluded.reorder_level
  returning id into v_canonical_id;

  if v_old_sku is not null and v_old_sku <> v_product.sku then
    update public.warehouse_stock_balance
    set item_code = v_product.sku,
        item_name = v_product.name,
        updated_at = now()
    where item_code = v_old_sku;

    if p_warehouse_product_id <> v_canonical_id then
      delete from public.warehouse_products where id = p_warehouse_product_id;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

commit;
-- Offline cash sales: a queued sale may be retried (connection drops again
-- mid-sync, tab closes before the response arrives, etc.). Without a
-- server-side dedupe key, a retry could create a second, duplicate invoice
-- for the same sale. client_ref is a client-generated id sent once per
-- sale attempt; retrying with the same client_ref returns the original
-- invoice instead of creating another one.

alter table public.invoices add column if not exists client_ref text;
create unique index if not exists invoices_client_ref_uidx
  on public.invoices(client_ref) where client_ref is not null;

-- create_invoice_no_stock gains one new trailing parameter (p_client_ref).
-- Adding a parameter via a bare "create or replace" would leave the old
-- 15-arg signature callable as a second, un-idempotent overload (the same
-- dangling-overload trap fixed earlier this project) — so the old signature
-- is dropped explicitly first.
drop function if exists public.create_invoice_no_stock(
  text, public.branch_location, jsonb, text, text, public.invoice_status,
  public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric
);

create or replace function public.create_invoice_no_stock(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null,
  p_amount_paid numeric default 0,
  p_discount numeric default 0,
  p_partial_method text default null,
  p_partial_momo text default null,
  p_is_cash_sale boolean default false,
  p_cash_tendered numeric default null,
  p_client_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_id uuid;
  v_number text;
  v_customer_id uuid;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_effective_paid numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric(12,2);
  v_sale_type text;
  v_existing public.invoices%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  -- Idempotent replay: if this exact client_ref already produced an
  -- invoice, hand back that invoice instead of creating a second one.
  if p_client_ref is not null then
    select * into v_existing from public.invoices where client_ref = p_client_ref;
    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'number', v_existing.number,
        'subtotal', v_existing.subtotal,
        'discount', v_existing.discount,
        'total', v_existing.total,
        'paid', v_existing.amount_paid,
        'balance', v_existing.balance,
        'idempotent_replay', true
      );
    end if;
  end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;
  if p_location not in ('Alabar', 'Morocco') then raise exception 'Invalid invoice location'; end if;
  if v_role <> 'admin' and p_location <> v_user_location then raise exception 'You cannot create invoices for this branch'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Invoice requires at least one item'; end if;
  if p_status = 'paid' and p_pay_method is null then raise exception 'Payment method is required for paid invoices'; end if;

  -- Any discount from a non-admin is held for approval instead of applied.
  -- Nothing is created yet — the customer record, invoice, and items are
  -- only produced once an admin approves the request (approve_invoice_request).
  -- This branch doesn't create an invoice row, so the client_ref check above
  -- can't catch a retry here — checked separately against any still-pending
  -- request carrying the same client_ref, so a retried offline sale with a
  -- discount doesn't queue a second approval request for the same sale.
  if v_role <> 'admin' and coalesce(p_discount, 0) > 0 then
    if p_client_ref is not null and exists (
      select 1 from public.invoice_edit_requests
      where status = 'pending' and payload->>'p_client_ref' = p_client_ref
    ) then
      return jsonb_build_object('success', true, 'discount_pending_approval', true, 'idempotent_replay', true);
    end if;

    insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
    values (
      null,
      'discount',
      v_user,
      jsonb_build_object(
        'p_customer_name', p_customer_name,
        'p_location', p_location,
        'p_items', p_items,
        'p_customer_phone', p_customer_phone,
        'p_customer_address', p_customer_address,
        'p_status', p_status,
        'p_pay_method', p_pay_method,
        'p_momo_number', p_momo_number,
        'p_notes', p_notes,
        'p_amount_paid', p_amount_paid,
        'p_discount', p_discount,
        'p_partial_method', p_partial_method,
        'p_partial_momo', p_partial_momo,
        'p_is_cash_sale', p_is_cash_sale,
        'p_cash_tendered', p_cash_tendered,
        'p_client_ref', p_client_ref
      )
    );
    return jsonb_build_object('success', true, 'discount_pending_approval', true);
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  select id into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_address, '')), ''),
      p_location,
      v_user
    ) returning id into v_customer_id;
  else
    update public.customers
    set phone = coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), phone),
        address = coalesce(nullif(trim(coalesce(p_customer_address, '')), ''), address)
    where id = v_customer_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);

    if v_item_name = '' then raise exception 'Item name is required'; end if;
    if v_item_qty < 1 then raise exception 'Quantity must be greater than zero'; end if;
    if v_item_price < 0 then raise exception 'Price cannot be negative'; end if;

    v_subtotal := v_subtotal + (v_item_qty * v_item_price);
  end loop;

  if v_subtotal <= 0 then raise exception 'Invoice total must be greater than zero'; end if;

  v_total := greatest(v_subtotal - coalesce(p_discount, 0), 0);

  v_effective_paid := case
    when p_status = 'paid' then v_total
    when p_status = 'partial' then least(greatest(coalesce(p_amount_paid, 0), 0), v_total)
    else 0
  end;

  insert into public.invoices (
    customer_id, customer_name, customer_phone, customer_address,
    location, subtotal, discount, total, status, pay_method, momo_number, notes,
    amount_paid, balance, partial_method, partial_momo_number, is_cash_sale, cash_tendered, created_by,
    client_ref
  ) values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    v_subtotal,
    coalesce(p_discount, 0),
    v_total,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_effective_paid,
    greatest(v_total - v_effective_paid, 0),
    p_partial_method,
    nullif(trim(coalesce(p_partial_momo, '')), ''),
    coalesce(p_is_cash_sale, false),
    p_cash_tendered,
    v_user,
    p_client_ref
  ) returning id, number into v_invoice_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);
    v_sale_type := coalesce(nullif(v_item->>'sale_type', ''), nullif(v_item->>'priceType', ''), 'retail');
    v_product_id := null;

    if nullif(v_item->>'product_id', '') is not null and v_item->>'product_id' <> 'null' then
      select id into v_product_id
      from public.products
      where id = (v_item->>'product_id')::uuid
      limit 1;
    end if;

    if v_product_id is null then
      select id into v_product_id
      from public.products
      where lower(name) = lower(v_item_name)
      limit 1;
    end if;

    insert into public.invoice_items (invoice_id, product_id, name, sale_type, qty, price)
    values (v_invoice_id, v_product_id, v_item_name, v_sale_type, v_item_qty, v_item_price);
  end loop;

  if v_effective_paid > 0 then
    insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
    values (
      v_invoice_id,
      v_effective_paid,
      coalesce(p_pay_method::text, p_partial_method),
      coalesce(p_momo_number, p_partial_momo),
      'Initial payment',
      v_user
    );
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || v_number || ' created for ' || trim(p_customer_name), v_user);

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'number', v_number,
    'subtotal', v_subtotal,
    'discount', coalesce(p_discount, 0),
    'total', v_total,
    'paid', v_effective_paid,
    'balance', greatest(v_total - v_effective_paid, 0)
  );
end;
$$;

-- Matches the anon+authenticated grant the original 15-arg signature had —
-- harmless for anon since the function itself rejects a null auth.uid().
grant execute on function public.create_invoice_no_stock(
  text, public.branch_location, jsonb, text, text, public.invoice_status,
  public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric, text
) to anon, authenticated;
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
