-- PCE- (cadena M↔T) en day_closes + un solo CIE- por cobrador/día.
-- Antes: check solo ^CIE- y unique (collector, date) → 502 al subir PCE o un segundo CIE.

alter table public.day_closes
  drop constraint if exists day_closes_ref_format;

alter table public.day_closes
  add constraint day_closes_ref_format
  check (ref ~ '^(CIE|PCE)-');

drop index if exists public.day_closes_collector_date_uidx;

-- Un CIE- por cobrador y día. Los PCE-M / PCE-T pueden coexistir.
create unique index if not exists day_closes_cie_collector_date_uidx
  on public.day_closes (collector_ref, close_date)
  where (ref ~ '^CIE-');

comment on constraint day_closes_ref_format on public.day_closes is
  'CIE- = cierre de jornada; PCE- = eslabón de caja M/T.';
