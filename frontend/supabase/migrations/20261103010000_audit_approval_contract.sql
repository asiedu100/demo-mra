-- Keep audit and approval operations behind explicit authenticated RPCs.
-- The browser never writes audit rows directly.

create or replace function public.mra_log_audit(
  p_action text,
  p_details jsonb default '{}'::jsonb,
  p_table_name text default null,
  p_record_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_log_id uuid;
begin
  if v_user is null or not public.is_active_user() then
    raise exception 'Only authenticated active users can create audit logs';
  end if;

  insert into public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    details
  )
  values (
    v_user,
    nullif(trim(coalesce(p_action, '')), ''),
    p_table_name,
    p_record_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_log_id;

  return v_log_id;
end;
$$;

revoke execute on function public.mra_log_audit(text, jsonb, text, uuid)
from public, anon;
grant execute on function public.mra_log_audit(text, jsonb, text, uuid)
to authenticated;

revoke execute on function public.approve_invoice_request(uuid) from public, anon;
grant execute on function public.approve_invoice_request(uuid) to authenticated;

revoke execute on function public.reject_invoice_request(uuid, text) from public, anon;
grant execute on function public.reject_invoice_request(uuid, text) to authenticated;
