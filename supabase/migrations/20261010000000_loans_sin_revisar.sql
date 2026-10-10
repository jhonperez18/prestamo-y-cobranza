-- «Revisar» deja de existir: el préstamo rápido nace con su estado real.
-- Los que quedaron marcados pasan a su estado por alertas (todos con 0 alertas → Activo).
-- No toca montos, cronograma ni préstamos dados de baja. La columna terms_pending queda (sin uso).

update public.loans
set status = 'Activo',
    kind = 'ok',
    terms_pending = false,
    updated_at = now()
where status = 'Revisar'
  and coalesce(collection_alerts, 0) = 0
  and balance > 0
  and not public.loan_status_deleted(status);

update public.loans
set terms_pending = false,
    updated_at = now()
where terms_pending
  and public.loan_status_active(status);
