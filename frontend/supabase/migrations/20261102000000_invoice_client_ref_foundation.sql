-- Foundation for server-side invoice idempotency.
--
-- The deployed branch-based invoice RPC is not defined in this repository's
-- historical schema snapshot, so this migration deliberately does not replace
-- or wrap that RPC. Add the client_ref parameter to the deployed RPC in the
-- same migration once its exact signature is confirmed from staging.

alter table public.invoices
  add column if not exists client_ref text;

create unique index if not exists invoices_client_ref_uidx
  on public.invoices (client_ref)
  where client_ref is not null;
