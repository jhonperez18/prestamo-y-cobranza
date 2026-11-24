-- Yesid N 21/11: el mirror selló con route='' y day_final = Inicial−gastos
-- (sin efectivo/préstamos). CIE 2.127.500 vs fórmula 2.313.500.
-- Ley: cash_float = Inicial + efectivo − préstamos − gastos. Nunca day_final de
-- cubetas M vacías en cobrador solo A/N.

-- 1) day_cash_figure: sin cadena, day_final = calculado (caja propia).
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
  v_loan_m numeric(14, 2) := 0;
  v_loan_t numeric(14, 2) := 0;
  v_loan_own numeric(14, 2) := 0;
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

  if v_expenses is null or jsonb_typeof(v_expenses) <> 'array' or jsonb_array_length(v_expenses) = 0 then
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

    v_route := null;
    select upper(btrim(c.route))
      into v_route
    from public.loans l
    join public.clients c on c.ref = l.client_ref
    where l.ref = coalesce(v_line->>'loanRef', '')
    limit 1;

    if v_chain then
      if v_route = 'T' then
        v_t_pre := v_t_pre + v_amount;
      else
        v_m_pre := v_m_pre + v_amount;
      end if;
    elsif v_own is not null then
      v_own_pre := v_own_pre + v_amount;
    end if;
  end loop;

  select
    coalesce(sum(cash.v_cash) filter (where upper(btrim(c.route)) = 'M'), 0),
    coalesce(sum(cash.v_cash) filter (where upper(btrim(c.route)) = 'T'), 0),
    coalesce(sum(cash.v_cash) filter (where v_own is not null and upper(btrim(c.route)) = v_own), 0)
    into v_loan_m, v_loan_t, v_loan_own
  from public.loans l
  join public.clients c on c.ref = l.client_ref
  cross join lateral (
    select
      case
        when coalesce(l.notes, '') like '%[[fb:combinado]]%' then
          coalesce(
            nullif(
              (regexp_match(coalesce(l.notes, ''), '\[\[split:efectivo:([0-9]+)\]\]'))[1],
              ''
            )::numeric,
            0
          )
        else trunc(l.capital)
      end as v_cash
  ) cash
  where left(btrim(coalesce(l.start_date, '')), 10) = to_char(p_date, 'YYYY-MM-DD')
    and l.deleted_at is null
    and lower(btrim(coalesce(l.status, ''))) not in ('eliminado', 'cancelado')
    and coalesce(l.notes, '') not like '%[[fb:nequi]]%'
    and coalesce(l.notes, '') not like '%[[fb:banco]]%'
    and coalesce(l.notes, '') not like '%[[fb:cartera]]%'
    and not exists (
      select 1
      from jsonb_array_elements(v_expenses) as exp
      where coalesce(exp.value->>'loanRef', '') = l.ref
        and (
          coalesce(exp.value->>'category', '') = 'prestamo_ruta'
          or coalesce(exp.value->>'id', '') = 'prestamo'
        )
    );

  if v_loan_m > v_m_pre then v_m_pre := v_loan_m; end if;
  if v_loan_t > v_t_pre then v_t_pre := v_loan_t; end if;
  if v_loan_own > v_own_pre then v_own_pre := v_loan_own; end if;

  v_m_close := v_opening + v_m_ef - v_m_gas - v_m_pre;
  v_final := v_m_close + v_t_ef - v_t_gas - v_t_pre;
  if v_chain then
    v_calculado := v_final;
  else
    -- Caja propia A/N: day_final no puede ser Inicial−gastos (cubetas M vacías).
    v_calculado := v_opening + v_own_ef - v_own_gas - v_own_pre;
    v_final := v_calculado;
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
    'saldo', v_calculado
  );
end;
$function$;

comment on function public.day_cash_figure(text, date) is
  'Caja del día: Saldo = fórmula. Sin cadena day_final = caja propia. CIE no pisa.';

revoke all on function public.day_cash_figure(text, date)
  from public, anon, authenticated;
grant execute on function public.day_cash_figure(text, date) to service_role;

-- 2) seal_day_close: route vacío → resuelve A/N; float = fórmula de partes (no saldo CIE).
create or replace function public.seal_day_close(
  p_collector_ref text,
  p_date date,
  p_route text,
  p_key text,
  p_by text,
  p_write_cie boolean default false,
  p_route_ref text default '',
  p_collector_name text default '',
  p_collected numeric default null,
  p_expenses jsonb default null,
  p_expenses_total numeric default null,
  p_movement_refs jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route text := upper(btrim(coalesce(p_route, '')));
  v_key text := btrim(coalesce(p_key, ''));
  v_mark text;
  v_ref text;
  v_float numeric(14, 2);
  v_fig jsonb;
  v_box jsonb;
  v_existing record;
  v_closed_at timestamptz := now();
  v_closed_at_text text := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sealed int := 0;
  v_name text;
  v_collected numeric(14, 2);
  v_expenses jsonb;
  v_expenses_total numeric(14, 2);
  v_refs jsonb;
  v_m_open int;
  v_has_chain boolean := false;
  v_own_saldo numeric(14, 2);
  v_sello_propio text;
  v_gas jsonb;
  v_gas_total numeric(14, 2);
  v_payload_ops int := 0;
  v_gas_ops int := 0;
  v_open_n numeric(14, 2);
  v_ef numeric(14, 2);
  v_pre numeric(14, 2);
  v_gas_n numeric(14, 2);
begin
  if p_collector_ref is null or btrim(p_collector_ref) = '' or p_date is null then
    return jsonb_build_object('ok', false, 'error', 'dato_invalido');
  end if;
  if v_key = '' then
    return jsonb_build_object('ok', false, 'error', 'sin_clave');
  end if;
  if v_route <> '' and v_route not in ('M', 'T', 'A', 'N') then
    return jsonb_build_object('ok', false, 'error', 'ruta_invalida');
  end if;

  v_mark := 'SEAL_KEY:' || v_key;
  v_ref := 'CIE-' || btrim(p_collector_ref) || '-' || to_char(p_date, 'YYYYMMDD');

  select * into v_existing
  from public.day_closes d
  where d.ref = v_ref
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(d.movement_refs, '[]'::jsonb)) e
      where e = v_mark
    )
  limit 1;
  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ref', v_existing.ref,
      'cash_float', v_existing.cash_float,
      'closed_at', v_existing.closed_at,
      'sealed_assignments', 0
    );
  end if;

  if v_route = 'T' then
    select count(*)::int into v_m_open
    from public.daily_assignments a
    left join public.clients c on c.ref = a.client_ref
    where a.collector_ref = btrim(p_collector_ref)
      and a.dispatch_date = p_date
      and (a.day_closed_at is null or btrim(a.day_closed_at) = '')
      and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) = 'M';
    if coalesce(v_m_open, 0) > 0 then
      return jsonb_build_object('ok', false, 'error', 'm_abierta');
    end if;
  end if;

  update public.daily_assignments a
     set day_closed_at = coalesce(nullif(btrim(a.day_closed_at), ''), v_closed_at_text),
         updated_at = v_closed_at
   where a.collector_ref = btrim(p_collector_ref)
     and a.dispatch_date = p_date
     and (a.day_closed_at is null or btrim(a.day_closed_at) = '')
     and (
       v_route = ''
       or upper(btrim(coalesce(
            (select nullif(c.route, '') from public.clients c where c.ref = a.client_ref),
            a.client_route
          ))) = v_route
     );
  get diagnostics v_sealed = row_count;

  if not p_write_cie then
    return jsonb_build_object(
      'ok', true,
      'cie', false,
      'sealed_assignments', v_sealed,
      'route', nullif(v_route, ''),
      'closed_at', v_closed_at
    );
  end if;

  select exists (
    select 1
    from public.daily_assignments a
    left join public.clients c on c.ref = a.client_ref
    where a.collector_ref = btrim(p_collector_ref)
      and a.dispatch_date = p_date
      and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) in ('M', 'T')
  ) into v_has_chain;

  -- Mirror a veces manda route=''. Sin M/T hoy → caja propia A/N.
  if v_route = '' and not coalesce(v_has_chain, false) then
    select upper(btrim(r.name))
      into v_route
    from public.routes r
    where r.collector_ref = btrim(p_collector_ref)
      and upper(btrim(r.name)) in ('A', 'N')
    limit 1;
    v_route := coalesce(v_route, '');
  end if;

  if v_route in ('A', 'N') and not coalesce(v_has_chain, false) then
    v_box := public.route_own_box(btrim(p_collector_ref), p_date, v_route);
    if coalesce(v_box->>'ok', 'false') <> 'true' then
      return jsonb_build_object(
        'ok', false,
        'error', coalesce(v_box->>'error', 'sin_saldo')
      );
    end if;
    -- Fórmula dura desde partes (no 'saldo': un CIE viejo no puede re-sellarse encima).
    v_open_n := trunc(coalesce((v_box->>'opening')::numeric, 0));
    v_ef := trunc(coalesce((v_box->>'efectivo')::numeric, 0));
    v_pre := trunc(coalesce((v_box->>'prestamos')::numeric, 0));
    v_gas_n := trunc(coalesce((v_box->>'gastos')::numeric, 0));
    v_float := v_open_n + v_ef - v_pre - v_gas_n;
    v_own_saldo := v_float;
    v_sello_propio :=
      'CIERRE_PROPIO@' || v_route || ':' ||
      v_own_saldo::text || '|' ||
      v_closed_at_text || '|' ||
      coalesce(nullif(btrim(p_by), ''), 'seal');
  else
    v_fig := public.day_cash_figure(btrim(p_collector_ref), p_date);
    if coalesce(v_fig->>'ready', 'false') <> 'true' then
      return jsonb_build_object(
        'ok', false,
        'error', coalesce(v_fig->>'error', 'no_listo'),
        'missing_day', v_fig->>'missing_day'
      );
    end if;
    if coalesce((v_fig->>'chain')::boolean, false) then
      v_float := trunc(coalesce(
        (v_fig->>'day_final')::numeric,
        (v_fig->>'calculado')::numeric,
        0
      ));
    else
      -- Sin cadena: calculado = caja propia. Nunca day_final de cubetas M vacías.
      v_float := trunc(coalesce(
        (v_fig->>'calculado')::numeric,
        (v_fig->>'day_final')::numeric,
        0
      ));
    end if;
    if v_route in ('A', 'N') then
      v_box := public.route_own_box(btrim(p_collector_ref), p_date, v_route);
      if coalesce(v_box->>'ok', 'false') = 'true' then
        v_own_saldo := trunc(coalesce((v_box->>'opening')::numeric, 0))
          + trunc(coalesce((v_box->>'efectivo')::numeric, 0))
          - trunc(coalesce((v_box->>'prestamos')::numeric, 0))
          - trunc(coalesce((v_box->>'gastos')::numeric, 0));
        v_sello_propio :=
          'CIERRE_PROPIO@' || v_route || ':' ||
          v_own_saldo::text || '|' ||
          v_closed_at_text || '|' ||
          coalesce(nullif(btrim(p_by), ''), 'seal');
      end if;
    end if;
  end if;

  select coalesce(nullif(btrim(p_collector_name), ''), c.name, btrim(p_collector_ref))
    into v_name
  from public.collectors c
  where c.ref = btrim(p_collector_ref)
  limit 1;
  v_name := coalesce(v_name, btrim(p_collector_ref));

  v_collected := trunc(coalesce(p_collected, 0));
  v_expenses := coalesce(p_expenses, '[]'::jsonb);
  v_expenses_total := trunc(coalesce(p_expenses_total, 0));

  select e.expenses, trunc(coalesce(e.expenses_total, 0))
    into v_gas, v_gas_total
  from public.day_expenses e
  where e.collector_ref = btrim(p_collector_ref)
    and e.expense_date = p_date
  limit 1;

  if v_gas is not null and jsonb_typeof(v_gas) = 'array' then
    select coalesce(count(*)::int, 0) into v_gas_ops
    from jsonb_array_elements(v_gas) x
    where trunc(coalesce((x.value->>'amount')::numeric, 0)) > 0
      and coalesce(x.value->>'category', '') <> 'prestamo_ruta'
      and coalesce(x.value->>'id', '') <> 'prestamo';
  end if;
  if jsonb_typeof(v_expenses) = 'array' then
    select coalesce(count(*)::int, 0) into v_payload_ops
    from jsonb_array_elements(v_expenses) x
    where trunc(coalesce((x.value->>'amount')::numeric, 0)) > 0
      and coalesce(x.value->>'category', '') <> 'prestamo_ruta'
      and coalesce(x.value->>'id', '') <> 'prestamo';
  end if;
  if coalesce(v_gas_ops, 0) > coalesce(v_payload_ops, 0) then
    v_expenses := v_gas;
    v_expenses_total := coalesce(v_gas_total, 0);
  elsif p_expenses is null and v_gas is not null then
    v_expenses := v_gas;
    v_expenses_total := coalesce(v_gas_total, 0);
  end if;

  v_refs := coalesce(p_movement_refs, '[]'::jsonb);
  if jsonb_typeof(v_refs) <> 'array' then
    v_refs := '[]'::jsonb;
  end if;
  v_refs := v_refs || jsonb_build_array(v_mark);
  if btrim(coalesce(p_by, '')) <> '' then
    v_refs := v_refs || jsonb_build_array('SEAL_BY:' || btrim(p_by));
  end if;
  if v_sello_propio is not null then
    v_refs := v_refs || jsonb_build_array(v_sello_propio);
  end if;

  select * into v_existing
  from public.day_closes d
  where d.ref = v_ref
  limit 1;

  if found then
    if v_existing.close_date < (timezone('America/Bogota', now()))::date then
      return jsonb_build_object(
        'ok', false,
        'error', 'ya_sellado',
        'ref', v_existing.ref,
        'cash_float', v_existing.cash_float
      );
    end if;
    update public.day_closes d
       set cash_float = v_float,
           collected = case when p_collected is null then d.collected else v_collected end,
           expenses = case
             when p_expenses is null and coalesce(v_gas_ops, 0) = 0 then d.expenses
             else v_expenses
           end,
           expenses_total = case
             when p_expenses is null and coalesce(v_gas_ops, 0) = 0 then d.expenses_total
             else v_expenses_total
           end,
           movement_refs = coalesce(d.movement_refs, '[]'::jsonb) || v_refs,
           closed_at = coalesce(d.closed_at, v_closed_at),
           updated_at = v_closed_at
     where d.ref = v_ref;

    return jsonb_build_object(
      'ok', true,
      'cie', true,
      'adopted', true,
      'ref', v_ref,
      'cash_float', v_float,
      'closed_at', coalesce(v_existing.closed_at, v_closed_at),
      'sealed_assignments', v_sealed,
      'route', nullif(v_route, ''),
      'by', nullif(btrim(coalesce(p_by, '')), '')
    );
  end if;

  insert into public.day_closes (
    ref,
    collector_ref,
    collector_name,
    close_date,
    route_ref,
    collected,
    expenses,
    expenses_total,
    cash_float,
    closed_at,
    movement_refs,
    updated_at
  ) values (
    v_ref,
    btrim(p_collector_ref),
    v_name,
    p_date,
    coalesce(nullif(btrim(p_route_ref), ''), 'RUT-D-' || btrim(p_collector_ref) || '-' || p_date::text),
    v_collected,
    v_expenses,
    v_expenses_total,
    v_float,
    v_closed_at,
    v_refs,
    v_closed_at
  );

  return jsonb_build_object(
    'ok', true,
    'cie', true,
    'ref', v_ref,
    'cash_float', v_float,
    'closed_at', v_closed_at,
    'sealed_assignments', v_sealed,
    'route', nullif(v_route, ''),
    'by', nullif(btrim(coalesce(p_by, '')), '')
  );
end;
$function$;

comment on function public.seal_day_close(text, date, text, text, text, boolean, text, text, numeric, jsonb, numeric, jsonb) is
  'Sella hoja/CIE. A/N: float = Inicial+efectivo−préstamos−gastos (partes). Route vacío resuelve A/N. Sin cadena no usa day_final de cubetas M.';

revoke all on function public.seal_day_close(text, date, text, text, text, boolean, text, text, numeric, jsonb, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.seal_day_close(text, date, text, text, text, boolean, text, text, numeric, jsonb, numeric, jsonb)
  to service_role;

notify pgrst, 'reload schema';
