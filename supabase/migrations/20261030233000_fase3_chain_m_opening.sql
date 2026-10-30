-- Fase 3 · corte 3.1 — Inicial M lo dueña la base (solo lectura).
-- Inicial M de un día = cash_float del último CIE- anterior.
-- No escribe cash_float, no cierra, no toca historia.

create or replace function public.chain_m_opening(
  p_collector_ref text,
  p_date date
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_cob text := nullif(btrim(coalesce(p_collector_ref, '')), '');
  v_prior_ref text;
  v_prior_date date;
  v_opening numeric(14, 2);
  v_last_cie date;
  v_last_sheet date;
  v_last_closed date;
begin
  if v_cob is null or p_date is null then
    return jsonb_build_object('ok', false, 'ready', false, 'error', 'dato_invalido');
  end if;

  select d.ref, d.close_date, trunc(coalesce(d.cash_float, 0))
    into v_prior_ref, v_prior_date, v_opening
  from public.day_closes d
  where d.collector_ref = v_cob
    and d.close_date < p_date
    and d.ref ~ '^CIE-'
  order by d.close_date desc
  limit 1;

  if v_prior_ref is null then
    return jsonb_build_object(
      'ok', true,
      'ready', false,
      'error', 'sin_cie_previo',
      'opening', null
    );
  end if;

  select max(d.close_date)
    into v_last_cie
  from public.day_closes d
  where d.collector_ref = v_cob
    and d.close_date < p_date
    and d.ref ~ '^CIE-';

  select max(a.dispatch_date)
    into v_last_sheet
  from public.daily_assignments a
  where a.collector_ref = v_cob
    and a.dispatch_date < p_date
    and a.day_closed_at is not null
    and btrim(a.day_closed_at) <> '';

  v_last_closed := greatest(
    coalesce(v_last_cie, date '0001-01-01'),
    coalesce(v_last_sheet, date '0001-01-01')
  );

  -- Hay un día cerrado después del último CIE → ese CIE no puede ser el Inicial.
  if v_last_closed > v_prior_date then
    return jsonb_build_object(
      'ok', true,
      'ready', false,
      'error', 'cie_faltante',
      'missing_day', to_char(v_last_closed, 'YYYY-MM-DD'),
      'prior_cie_ref', v_prior_ref,
      'prior_cie_date', to_char(v_prior_date, 'YYYY-MM-DD'),
      'opening', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'ready', true,
    'opening', v_opening,
    'prior_cie_ref', v_prior_ref,
    'prior_cie_date', to_char(v_prior_date, 'YYYY-MM-DD')
  );
end;
$function$;

comment on function public.chain_m_opening(text, date) is
  'Fase 3.1: Inicial M = cash_float del último CIE- anterior. Solo lee. ready=false si falta CIE del último día cerrado.';

revoke all on function public.chain_m_opening(text, date)
  from public, anon, authenticated;
grant execute on function public.chain_m_opening(text, date) to service_role;

notify pgrst, 'reload schema';
