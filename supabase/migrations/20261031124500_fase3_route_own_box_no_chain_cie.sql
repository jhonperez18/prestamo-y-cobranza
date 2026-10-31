-- Urgencia 31/10 (2): route_own_box no puede anclar A al CIE- de la cadena M/T.
-- Edgar trabaja M/T/A: su CIE- es saldo M↔T, no la caja de A. Solo usar CIE- como ancla
-- si ese día el cobrador NO tuvo visitas M/T (caso Yesid → N).

create or replace function public.route_own_box(
  p_collector_ref text,
  p_date date,
  p_route text
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_route text := upper(btrim(coalesce(p_route, '')));
  v_mark text;
  v_anchor date;
  v_real numeric(14, 2);
  v_cie_date date;
  v_cie_float numeric(14, 2);
  v_adj_date date;
  v_adj_real numeric(14, 2);
  v_efectivo numeric(14, 2) := 0;
  v_prestamos numeric(14, 2) := 0;
  v_gastos numeric(14, 2) := 0;
  v_day_ef numeric(14, 2) := 0;
  v_day_pre numeric(14, 2) := 0;
  v_day_gas numeric(14, 2) := 0;
  v_saldo numeric(14, 2);
  v_opening numeric(14, 2);
  v_cie_from date := date '2026-10-08';
begin
  if p_collector_ref is null or btrim(p_collector_ref) = '' or p_date is null then
    return jsonb_build_object('ok', false, 'error', 'dato_invalido');
  end if;
  if v_route not in ('A', 'N') then
    return jsonb_build_object('ok', false, 'error', 'ruta_invalida');
  end if;
  v_mark := 'AJUSTE@' || v_route || ':%';

  select d.close_date,
         nullif(split_part(split_part(entry, ':', 2), '|', 2), '')::numeric
    into v_adj_date, v_adj_real
  from public.day_closes d
  cross join lateral jsonb_array_elements_text(coalesce(d.movement_refs, '[]'::jsonb)) as entry
  where d.collector_ref = btrim(p_collector_ref)
    and d.close_date < p_date
    and entry like v_mark
  order by d.close_date desc
  limit 1;

  -- CIE- solo si ese día NO fue cadena M/T (misma regla que sealedRouteClosing en el aparato).
  select d.close_date, trunc(coalesce(d.cash_float, 0))
    into v_cie_date, v_cie_float
  from public.day_closes d
  where d.collector_ref = btrim(p_collector_ref)
    and d.close_date < p_date
    and d.close_date >= v_cie_from
    and d.ref ~ '^CIE-'
    and not exists (
      select 1
      from public.daily_assignments a
      left join public.clients c on c.ref = a.client_ref
      where a.collector_ref = d.collector_ref
        and a.dispatch_date = d.close_date
        and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) in ('M', 'T')
    )
  order by d.close_date desc
  limit 1;

  if v_cie_date is not null and (v_adj_date is null or v_cie_date >= v_adj_date) then
    v_anchor := v_cie_date;
    v_real := v_cie_float;
  elsif v_adj_date is not null and v_adj_real is not null then
    v_anchor := v_adj_date;
    v_real := trunc(v_adj_real);
  else
    return jsonb_build_object('ok', false, 'error', 'sin_ajuste_' || lower(v_route));
  end if;

  select coalesce(sum(trunc(p.amount)), 0)
    into v_efectivo
  from public.payments p
  join public.loans l on l.ref = p.loan_ref
  join public.clients c on c.ref = l.client_ref
  where p.collector_ref = btrim(p_collector_ref)
    and p.paid_date > v_anchor
    and p.paid_date <= p_date
    and coalesce(p.payment_type, '') <> 'Anulado'
    and coalesce(p.charge_label, '') not like 'ANULADO:%'
    and lower(btrim(coalesce(p.method, ''))) not in ('nequi', 'banco')
    and upper(btrim(c.route)) = v_route;

  select coalesce(sum(trunc(p.amount)), 0)
    into v_day_ef
  from public.payments p
  join public.loans l on l.ref = p.loan_ref
  join public.clients c on c.ref = l.client_ref
  where p.collector_ref = btrim(p_collector_ref)
    and p.paid_date = p_date
    and coalesce(p.payment_type, '') <> 'Anulado'
    and coalesce(p.charge_label, '') not like 'ANULADO:%'
    and lower(btrim(coalesce(p.method, ''))) not in ('nequi', 'banco')
    and upper(btrim(c.route)) = v_route;

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_prestamos
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  join public.loans l on l.ref = line->>'loanRef'
  join public.clients c on c.ref = l.client_ref
  where d.collector_ref = btrim(p_collector_ref)
    and d.ref ~ '^CIE-'
    and d.close_date > v_anchor
    and d.close_date <= p_date
    and (
      coalesce(line->>'category', '') = 'prestamo_ruta'
      or coalesce(line->>'id', '') = 'prestamo'
    )
    and upper(btrim(c.route)) = v_route;

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_day_pre
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  join public.loans l on l.ref = line->>'loanRef'
  join public.clients c on c.ref = l.client_ref
  where d.collector_ref = btrim(p_collector_ref)
    and d.ref ~ '^CIE-'
    and d.close_date = p_date
    and (
      coalesce(line->>'category', '') = 'prestamo_ruta'
      or coalesce(line->>'id', '') = 'prestamo'
    )
    and upper(btrim(c.route)) = v_route;

  select
    v_prestamos + coalesce(sum(trunc((line->>'amount')::numeric)), 0),
    v_day_pre + coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_prestamos, v_day_pre
  from public.day_expenses e
  cross join lateral jsonb_array_elements(coalesce(e.expenses, '[]'::jsonb)) as line
  join public.loans l on l.ref = line->>'loanRef'
  join public.clients c on c.ref = l.client_ref
  where e.collector_ref = btrim(p_collector_ref)
    and e.expense_date = p_date
    and (
      coalesce(line->>'category', '') = 'prestamo_ruta'
      or coalesce(line->>'id', '') = 'prestamo'
    )
    and upper(btrim(c.route)) = v_route
    and not exists (
      select 1 from public.day_closes d
      where d.collector_ref = e.collector_ref
        and d.close_date = e.expense_date
        and d.ref ~ '^CIE-'
    );

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_gastos
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  where d.collector_ref = btrim(p_collector_ref)
    and d.ref ~ '^CIE-'
    and d.close_date > v_anchor
    and d.close_date <= p_date
    and coalesce(line->>'category', '') <> 'prestamo_ruta'
    and coalesce(line->>'id', '') <> 'prestamo'
    and trunc(coalesce((line->>'amount')::numeric, 0)) > 0
    and (
      upper(btrim(coalesce(line->>'route', ''))) = v_route
      or (
        btrim(coalesce(line->>'route', '')) = ''
        and not exists (
          select 1
          from public.daily_assignments a
          left join public.clients c on c.ref = a.client_ref
          where a.collector_ref = d.collector_ref
            and a.dispatch_date = d.close_date
            and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) in ('M', 'T')
        )
      )
    );

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_day_gas
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  where d.collector_ref = btrim(p_collector_ref)
    and d.ref ~ '^CIE-'
    and d.close_date = p_date
    and coalesce(line->>'category', '') <> 'prestamo_ruta'
    and coalesce(line->>'id', '') <> 'prestamo'
    and trunc(coalesce((line->>'amount')::numeric, 0)) > 0
    and (
      upper(btrim(coalesce(line->>'route', ''))) = v_route
      or (
        btrim(coalesce(line->>'route', '')) = ''
        and not exists (
          select 1
          from public.daily_assignments a
          left join public.clients c on c.ref = a.client_ref
          where a.collector_ref = d.collector_ref
            and a.dispatch_date = d.close_date
            and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) in ('M', 'T')
        )
      )
    );

  select
    v_gastos + coalesce(sum(trunc((line->>'amount')::numeric)), 0),
    v_day_gas + coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_gastos, v_day_gas
  from public.day_expenses e
  cross join lateral jsonb_array_elements(coalesce(e.expenses, '[]'::jsonb)) as line
  where e.collector_ref = btrim(p_collector_ref)
    and e.expense_date = p_date
    and coalesce(line->>'category', '') <> 'prestamo_ruta'
    and coalesce(line->>'id', '') <> 'prestamo'
    and trunc(coalesce((line->>'amount')::numeric, 0)) > 0
    and (
      upper(btrim(coalesce(line->>'route', ''))) = v_route
      or (
        btrim(coalesce(line->>'route', '')) = ''
        and not exists (
          select 1
          from public.daily_assignments a
          left join public.clients c on c.ref = a.client_ref
          where a.collector_ref = e.collector_ref
            and a.dispatch_date = e.expense_date
            and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) in ('M', 'T')
        )
      )
    )
    and not exists (
      select 1 from public.day_closes d
      where d.collector_ref = e.collector_ref
        and d.close_date = e.expense_date
        and d.ref ~ '^CIE-'
    );

  v_saldo := trunc(v_real) + v_efectivo - v_prestamos - v_gastos;
  v_opening := v_saldo - v_day_ef + v_day_pre + v_day_gas;

  return jsonb_build_object(
    'ok', true,
    'route', v_route,
    'anchor', v_anchor,
    'anchor_real', v_real,
    'opening', v_opening,
    'efectivo', v_day_ef,
    'prestamos', v_day_pre,
    'gastos', v_day_gas,
    'saldo', v_saldo
  );
end;
$function$;

comment on function public.route_own_box(text, date, text) is
  'Fase 3.3: caja A/N. CIE ancla solo si el día no es cadena M/T. Solo lee.';

revoke all on function public.route_own_box(text, date, text)
  from public, anon, authenticated;
grant execute on function public.route_own_box(text, date, text) to service_role;

notify pgrst, 'reload schema';
