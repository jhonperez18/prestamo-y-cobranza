-- Urgencia 31/10: day_closed_at es text; seal_day_close mezclaba timestamptz → COALESCE fallaba
-- y el CIE no se escribía. Inicial M del día siguiente = 0 (cie_faltante).

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

  -- day_closed_at es text en este esquema (no timestamptz).
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

  if v_route in ('A', 'N') then
    v_box := public.route_own_box(btrim(p_collector_ref), p_date, v_route);
    if coalesce(v_box->>'ok', 'false') <> 'true' then
      v_fig := public.day_cash_figure(btrim(p_collector_ref), p_date);
      if coalesce(v_fig->>'ready', 'false') <> 'true' then
        return jsonb_build_object(
          'ok', false,
          'error', coalesce(v_box->>'error', v_fig->>'error', 'sin_saldo'),
          'missing_day', v_fig->>'missing_day'
        );
      end if;
      v_float := trunc(coalesce((v_fig->>'saldo')::numeric, 0));
    else
      v_float := trunc(coalesce((v_box->>'saldo')::numeric, 0));
    end if;
  else
    v_fig := public.day_cash_figure(btrim(p_collector_ref), p_date);
    if coalesce(v_fig->>'ready', 'false') <> 'true' then
      return jsonb_build_object(
        'ok', false,
        'error', coalesce(v_fig->>'error', 'no_listo'),
        'missing_day', v_fig->>'missing_day'
      );
    end if;
    v_float := trunc(coalesce((v_fig->>'saldo')::numeric, 0));
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
  v_refs := coalesce(p_movement_refs, '[]'::jsonb);
  if jsonb_typeof(v_refs) <> 'array' then
    v_refs := '[]'::jsonb;
  end if;
  v_refs := v_refs || jsonb_build_array(v_mark);
  if btrim(coalesce(p_by, '')) <> '' then
    v_refs := v_refs || jsonb_build_array('SEAL_BY:' || btrim(p_by));
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
           expenses = case when p_expenses is null then d.expenses else v_expenses end,
           expenses_total = case when p_expenses_total is null then d.expenses_total else v_expenses_total end,
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
  'Fase 4.1: sella hoja/CIE. day_closed_at text. cash_float de la base.';

revoke all on function public.seal_day_close(text, date, text, text, text, boolean, text, text, numeric, jsonb, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.seal_day_close(text, date, text, text, text, boolean, text, text, numeric, jsonb, numeric, jsonb)
  to service_role;

notify pgrst, 'reload schema';
