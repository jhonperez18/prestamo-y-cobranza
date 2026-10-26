-- Caja propia de A. Solo lee. No es el CIE de la cadena.
-- Inicial = último ajuste de A. Después: efectivo de A − préstamos en efectivo de A.
-- Un gasto marcado en A sale de esta caja. Sin marca sigue en M. El de T sigue en T.

create or replace function public.route_a_box(p_collector_ref text, p_date date)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_anchor date;
  v_real numeric(14, 2);
  v_efectivo numeric(14, 2) := 0;
  v_prestamos numeric(14, 2) := 0;
  v_gastos numeric(14, 2) := 0;
  v_day_ef numeric(14, 2) := 0;
  v_day_pre numeric(14, 2) := 0;
  v_saldo numeric(14, 2);
begin
  if p_collector_ref is null or btrim(p_collector_ref) = '' or p_date is null then
    return jsonb_build_object('ok', false, 'error', 'dato_invalido');
  end if;

  select d.close_date,
         nullif(split_part(split_part(entry, ':', 2), '|', 2), '')::numeric
    into v_anchor, v_real
  from public.day_closes d
  cross join lateral jsonb_array_elements_text(coalesce(d.movement_refs, '[]'::jsonb)) as entry
  where d.collector_ref = p_collector_ref
    and d.close_date < p_date
    and entry like 'AJUSTE@A:%'
  order by d.close_date desc
  limit 1;

  if v_anchor is null or v_real is null then
    return jsonb_build_object('ok', false, 'error', 'sin_ajuste_a');
  end if;

  select coalesce(sum(trunc(p.amount)), 0)
    into v_efectivo
  from public.payments p
  join public.loans l on l.ref = p.loan_ref
  join public.clients c on c.ref = l.client_ref
  where p.collector_ref = p_collector_ref
    and p.paid_date > v_anchor
    and p.paid_date <= p_date
    and coalesce(p.payment_type, '') <> 'Anulado'
    and coalesce(p.charge_label, '') not like 'ANULADO:%'
    and lower(btrim(coalesce(p.method, ''))) not in ('nequi', 'banco')
    and upper(btrim(c.route)) = 'A';

  select coalesce(sum(trunc(p.amount)), 0)
    into v_day_ef
  from public.payments p
  join public.loans l on l.ref = p.loan_ref
  join public.clients c on c.ref = l.client_ref
  where p.collector_ref = p_collector_ref
    and p.paid_date = p_date
    and coalesce(p.payment_type, '') <> 'Anulado'
    and coalesce(p.charge_label, '') not like 'ANULADO:%'
    and lower(btrim(coalesce(p.method, ''))) not in ('nequi', 'banco')
    and upper(btrim(c.route)) = 'A';

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_prestamos
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  join public.loans l on l.ref = line->>'loanRef'
  join public.clients c on c.ref = l.client_ref
  where d.collector_ref = p_collector_ref
    and d.ref ~ '^CIE-'
    and d.close_date > v_anchor
    and d.close_date <= p_date
    and (
      coalesce(line->>'category', '') = 'prestamo_ruta'
      or coalesce(line->>'id', '') = 'prestamo'
    )
    and upper(btrim(c.route)) = 'A';

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_day_pre
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  join public.loans l on l.ref = line->>'loanRef'
  join public.clients c on c.ref = l.client_ref
  where d.collector_ref = p_collector_ref
    and d.ref ~ '^CIE-'
    and d.close_date = p_date
    and (
      coalesce(line->>'category', '') = 'prestamo_ruta'
      or coalesce(line->>'id', '') = 'prestamo'
    )
    and upper(btrim(c.route)) = 'A';

  select coalesce(sum(trunc((line->>'amount')::numeric)), 0)
    into v_gastos
  from public.day_closes d
  cross join lateral jsonb_array_elements(coalesce(d.expenses, '[]'::jsonb)) as line
  where d.collector_ref = p_collector_ref
    and d.ref ~ '^CIE-'
    and d.close_date > v_anchor
    and d.close_date <= p_date
    and coalesce(line->>'category', '') <> 'prestamo_ruta'
    and coalesce(line->>'id', '') <> 'prestamo'
    and trunc(coalesce((line->>'amount')::numeric, 0)) > 0
    and (
      upper(btrim(coalesce(line->>'route', ''))) = 'A'
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

  v_saldo := v_real + v_efectivo - v_prestamos - v_gastos;

  return jsonb_build_object(
    'ok', true,
    'anchor', v_anchor,
    'anchor_real', v_real,
    'efectivo', v_day_ef,
    'prestamos', v_day_pre,
    'gastos', v_gastos,
    'saldo', v_saldo
  );
end;
$function$;

revoke all on function public.route_a_box(text, date) from public, anon, authenticated;
grant execute on function public.route_a_box(text, date) to service_role;

comment on function public.route_a_box(text, date) is
  'Lee la caja propia de A. No es el CIE de M y T. No escribe nada.';

notify pgrst, 'reload schema';
