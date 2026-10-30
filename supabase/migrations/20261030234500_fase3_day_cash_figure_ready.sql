-- Fase 3 · corte 3.2 — caja del día leída en la base (m_closing / day_final).
-- Inicial = chain_m_opening (3.1). No escribe cash_float.
-- Si el Inicial no está listo, ready=false (no inventa opening 0).

create or replace function public.day_cash_figure(p_collector_ref text, p_date date)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_chain boolean;
  v_own text;
  v_opening numeric(14, 2);
  v_cie numeric(14, 2);
  v_expenses jsonb := '[]'::jsonb;
  v_line jsonb;
  v_amount numeric(14, 2);
  v_route text;
  v_prestamo boolean;
  v_m_ef numeric(14, 2) := 0;
  v_t_ef numeric(14, 2) := 0;
  v_own_ef numeric(14, 2) := 0;
  v_m_gas numeric(14, 2) := 0;
  v_t_gas numeric(14, 2) := 0;
  v_own_gas numeric(14, 2) := 0;
  v_m_pre numeric(14, 2) := 0;
  v_t_pre numeric(14, 2) := 0;
  v_own_pre numeric(14, 2) := 0;
  v_m_close numeric(14, 2);
  v_final numeric(14, 2);
  v_calculado numeric(14, 2);
  v_open jsonb;
begin
  if p_collector_ref is null or btrim(p_collector_ref) = '' or p_date is null then
    return jsonb_build_object('ok', false, 'ready', false, 'error', 'dato_invalido');
  end if;

  v_open := public.chain_m_opening(p_collector_ref, p_date);
  if coalesce((v_open->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'ready', false,
      'error', coalesce(v_open->>'error', 'sin_inicial')
    );
  end if;
  if coalesce((v_open->>'ready')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', true,
      'ready', false,
      'error', coalesce(v_open->>'error', 'no_listo'),
      'missing_day', v_open->>'missing_day',
      'prior_cie_ref', v_open->>'prior_cie_ref',
      'prior_cie_date', v_open->>'prior_cie_date'
    );
  end if;
  v_opening := trunc(coalesce((v_open->>'opening')::numeric, 0));

  select exists (
    select 1
    from public.routes r
    where r.collector_ref = p_collector_ref
      and upper(btrim(r.name)) in ('M', 'T')
  )
  into v_chain;

  select upper(btrim(r.name))
    into v_own
  from public.routes r
  where r.collector_ref = p_collector_ref
    and upper(btrim(r.name)) in ('A', 'N')
  limit 1;

  select d.cash_float, d.expenses
    into v_cie, v_expenses
  from public.day_closes d
  where d.collector_ref = p_collector_ref
    and d.close_date = p_date
    and d.ref ~ '^CIE-'
  limit 1;

  if v_expenses is null then
    select e.expenses
      into v_expenses
    from public.day_expenses e
    where e.collector_ref = p_collector_ref
      and e.expense_date = p_date
    limit 1;
  end if;
  v_expenses := coalesce(v_expenses, '[]'::jsonb);

  select
    coalesce(sum(trunc(p.amount)) filter (where upper(btrim(c.route)) = 'M'), 0),
    coalesce(sum(trunc(p.amount)) filter (where upper(btrim(c.route)) = 'T'), 0),
    coalesce(sum(trunc(p.amount)) filter (where v_own is not null and upper(btrim(c.route)) = v_own), 0)
    into v_m_ef, v_t_ef, v_own_ef
  from public.payments p
  join public.loans l on l.ref = p.loan_ref
  join public.clients c on c.ref = l.client_ref
  where p.collector_ref = p_collector_ref
    and p.paid_date = p_date
    and coalesce(p.payment_type, '') <> 'Anulado'
    and lower(btrim(coalesce(p.method, ''))) not in ('nequi', 'banco');

  for v_line in
    select value from jsonb_array_elements(v_expenses)
  loop
    v_amount := trunc(coalesce((v_line->>'amount')::numeric, 0));
    if v_amount <= 0 then
      continue;
    end if;
    v_prestamo := coalesce(v_line->>'category', '') = 'prestamo_ruta'
      or coalesce(v_line->>'id', '') = 'prestamo';
    if not v_prestamo then
      v_route := upper(btrim(coalesce(v_line->>'route', '')));
      if v_route = 'T' then
        v_t_gas := v_t_gas + v_amount;
      else
        v_m_gas := v_m_gas + v_amount;
      end if;
      if not v_chain then
        v_own_gas := v_own_gas + v_amount;
      end if;
      continue;
    end if;

    select upper(btrim(c.route))
      into v_route
    from public.loans l
    join public.clients c on c.ref = l.client_ref
    where l.ref = coalesce(v_line->>'loanRef', '')
    limit 1;

    if v_chain and coalesce(v_route, '') not in ('A', 'N') then
      if v_route = 'T' then
        v_t_pre := v_t_pre + v_amount;
      else
        v_m_pre := v_m_pre + v_amount;
      end if;
    end if;
    if v_own is not null and v_route = v_own then
      v_own_pre := v_own_pre + v_amount;
    end if;
  end loop;

  v_m_close := v_opening + v_m_ef - v_m_gas - v_m_pre;
  v_final := v_m_close + v_t_ef - v_t_gas - v_t_pre;
  if v_chain then
    v_calculado := v_final;
  else
    v_calculado := v_opening + v_own_ef - v_own_gas - v_own_pre;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ready', true,
    'chain', v_chain,
    'own_route', v_own,
    'opening', v_opening,
    'prior_cie_ref', v_open->>'prior_cie_ref',
    'prior_cie_date', v_open->>'prior_cie_date',
    'm_efectivo', v_m_ef,
    'm_gastos', v_m_gas,
    'm_prestamos', v_m_pre,
    'm_closing', v_m_close,
    't_efectivo', v_t_ef,
    't_gastos', v_t_gas,
    't_prestamos', v_t_pre,
    'day_final', v_final,
    'own_efectivo', v_own_ef,
    'own_gastos', v_own_gas,
    'own_prestamos', v_own_pre,
    'calculado', v_calculado,
    'cie', v_cie,
    'saldo', coalesce(v_cie, v_calculado)
  );
end;
$function$;

comment on function public.day_cash_figure(text, date) is
  'Fase 3.2: caja del día (m_closing / day_final). Inicial = chain_m_opening. No escribe cash_float.';

revoke all on function public.day_cash_figure(text, date)
  from public, anon, authenticated;
grant execute on function public.day_cash_figure(text, date) to service_role;

notify pgrst, 'reload schema';
