-- Cobros con método Banco (consignación). Antes solo efectivo|nequi → 502 al espejar.
alter table public.payments
  drop constraint if exists payments_method_ok;

alter table public.payments
  add constraint payments_method_ok
  check (method in ('efectivo', 'nequi', 'banco'));

comment on column public.payments.method is 'efectivo | nequi | banco';
