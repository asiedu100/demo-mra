-- Branch-backed warehouse movements and approval requests for the MRA demo.

create table if not exists public.invoice_edit_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  request_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text
);

alter table public.invoice_edit_requests enable row level security;

create or replace function public.mra_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

create or replace function public.mra_record_stock_movement(
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_reason text default null,
  p_destination_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_destination_before numeric;
  v_destination_after numeric;
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_movement_type not in ('opening_stock', 'stock_in', 'stock_out', 'adjustment', 'transfer') then
    raise exception 'Unsupported movement type';
  end if;

  v_is_admin := public.mra_is_admin();
  if not v_is_admin and not exists (
    select 1 from public.user_branch_access
    where user_id = auth.uid() and branch_id = p_branch_id
  ) then raise exception 'You are not assigned to this branch'; end if;

  if p_movement_type = 'transfer' and (
    p_destination_branch_id is null or p_destination_branch_id = p_branch_id
  ) then raise exception 'A different destination branch is required'; end if;

  select quantity into v_before
  from public.branch_inventory
  where branch_id = p_branch_id and product_id = p_product_id
  for update;
  v_before := coalesce(v_before, 0);
  v_after := v_before + case when p_movement_type in ('stock_out', 'transfer')
    then -p_quantity else p_quantity end;
  if v_after < 0 then raise exception 'Insufficient stock'; end if;

  insert into public.branch_inventory(branch_id, product_id, quantity)
  values (p_branch_id, p_product_id, v_after)
  on conflict (branch_id, product_id)
  do update set quantity = excluded.quantity, updated_at = now();

  insert into public.stock_history(
    branch_id, product_id, movement_type, quantity_change,
    quantity_before, quantity_after, reason
  ) values (
    p_branch_id, p_product_id, p_movement_type,
    case when p_movement_type in ('stock_out', 'transfer') then -p_quantity else p_quantity end,
    v_before, v_after, p_reason
  );

  if p_movement_type = 'transfer' then
    select quantity into v_destination_before
    from public.branch_inventory
    where branch_id = p_destination_branch_id and product_id = p_product_id
    for update;
    v_destination_before := coalesce(v_destination_before, 0);
    v_destination_after := v_destination_before + p_quantity;
    insert into public.branch_inventory(branch_id, product_id, quantity)
    values (p_destination_branch_id, p_product_id, v_destination_after)
    on conflict (branch_id, product_id)
    do update set quantity = excluded.quantity, updated_at = now();
    insert into public.stock_history(
      branch_id, product_id, movement_type, quantity_change,
      quantity_before, quantity_after, reason
    ) values (
      p_destination_branch_id, p_product_id, 'transfer', p_quantity,
      v_destination_before, v_destination_after, p_reason
    );
  end if;

  return jsonb_build_object('success', true, 'quantity_after', v_after);
end;
$$;

grant execute on function public.mra_record_stock_movement(
  uuid, uuid, numeric, text, text, uuid
) to authenticated;

drop policy if exists "mra approvals admin read" on public.invoice_edit_requests;
create policy "mra approvals admin read"
on public.invoice_edit_requests for select
to authenticated
using (public.mra_is_admin() or requested_by = auth.uid());

drop policy if exists "mra approvals staff create" on public.invoice_edit_requests;
create policy "mra approvals staff create"
on public.invoice_edit_requests for insert
to authenticated
with check (requested_by = auth.uid());

create or replace function public.approve_invoice_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mra_is_admin() then raise exception 'Administrator access required'; end if;
  update public.invoice_edit_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending';
  if not found then raise exception 'Approval request is missing or already reviewed'; end if;
  return jsonb_build_object('success', true, 'status', 'approved');
end;
$$;

create or replace function public.reject_invoice_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mra_is_admin() then raise exception 'Administrator access required'; end if;
  update public.invoice_edit_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = nullif(trim(p_reason), '')
  where id = p_request_id and status = 'pending';
  if not found then raise exception 'Approval request is missing or already reviewed'; end if;
  return jsonb_build_object('success', true, 'status', 'rejected');
end;
$$;

grant execute on function public.approve_invoice_request(uuid) to authenticated;
grant execute on function public.reject_invoice_request(uuid, text) to authenticated;
