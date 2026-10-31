-- Fase 4 · corte 4.4 — reabrir hoja de hoy por orden atómica.
-- Marca REABIERTA@ruta + suelta day_closed_at de esa planilla. Nada se borra.

create or replace function public.reopen_day_sheet(
  p_collector_ref text,
  p_route text,
  p_by text,
  p_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_collector text := btrim(coalesce(p_collector_ref, ''));
  v_route text := upper(btrim(coalesce(p_route, '')));
  v_by text := btrim(regexp_replace(coalesce(p_by, ''), '\s+', ' ', 'g'));
  v_key text := btrim(coalesce(p_key, ''));
  v_today date := (timezone('America/Bogota', now()))::date;
  v_mins int := (
    extract(hour from timezone('America/Bogota', now()))::int * 60
    + extract(minute from timezone('America/Bogota', now()))::int
  );
  v_ref text;
  v_cie record;
  v_stamp timestamptz := now();
  v_at text;
  v_routes text[] := array[]::text[];
  v_target text;
  v_markers jsonb := '[]'::jsonb;
  v_refs jsonb;
  v_mark text;
  v_reopened int := 0;
  v_skipped int := 0;
  v_m_sealed int := 0;
  v_m_open int := 0;
  v_t_live boolean := false;
  v_route_live boolean := false;
  v_has_ajuste boolean := false;
  v_reopens jsonb := '[]'::jsonb;
  v_close_ref text := '';
  v_has_cie boolean := false;
begin
  if v_collector = '' or v_route = '' then
    return jsonb_build_object('ok', false, 'error', 'dato_invalido');
  end if;
  if v_route not in ('M', 'T', 'A', 'N') then
    return jsonb_build_object('ok', false, 'error', 'ruta_invalida');
  end if;
  if length(v_by) < 1 then
    return jsonb_build_object('ok', false, 'error', 'sin_quien');
  end if;
  if v_mins >= (23 * 60 + 30) then
    return jsonb_build_object('ok', false, 'error', 'despues_corte');
  end if;

  v_ref := 'CIE-' || v_collector || '-' || to_char(v_today, 'YYYYMMDD');

  select * into v_cie
  from public.day_closes d
  where d.ref = v_ref
  limit 1;
  v_has_cie := found;

  -- Idempotencia por clave.
  if v_key <> '' and v_has_cie then
    v_mark := 'REOPEN_KEY:' || v_key;
    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
      where e = v_mark
    ) then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'ref', v_cie.ref,
        'date', v_today,
        'routes', jsonb_build_array(v_route),
        'reopened_visits', 0
      );
    end if;
  end if;

  -- Sin CIE-: solo M (cerró y T aún no).
  if not v_has_cie then
    if v_route <> 'M' then
      return jsonb_build_object('ok', false, 'error', 'sin_cie');
    end if;

    select
      count(*) filter (where a.day_closed_at is not null)::int,
      count(*) filter (
        where a.day_closed_at is null
          and coalesce(nullif(lower(btrim(a.visit_status)), ''), 'pendiente') not in ('cobrado', 'omitido')
          and coalesce(nullif(btrim(a.payment_ref), ''), '') = ''
      )::int
    into v_m_sealed, v_m_open
    from public.daily_assignments a
    left join public.clients c on c.ref = a.client_ref
    where a.collector_ref = v_collector
      and a.dispatch_date = v_today
      and upper(btrim(coalesce(nullif(c.route, ''), a.client_route))) = 'M';

    if coalesce(v_m_sealed, 0) = 0 or coalesce(v_m_open, 0) > 0 then
      return jsonb_build_object('ok', false, 'error', 'm_no_cerrada');
    end if;

    v_at := to_char(timezone('UTC', v_stamp), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    update public.daily_assignments a
       set visit_status = 'pendiente',
           skip_reason = null,
           day_closed_at = null,
           updated_at = v_stamp
     where a.collector_ref = v_collector
       and a.dispatch_date = v_today
       and upper(btrim(coalesce(
            (select nullif(c.route, '') from public.clients c where c.ref = a.client_ref),
            a.client_route
          ))) = 'M'
       and a.visit_status = 'omitido'
       and a.skip_reason = 'Cierre de jornada'
       and coalesce(nullif(btrim(a.payment_ref), ''), '') = '';
    get diagnostics v_skipped = row_count;

    update public.daily_assignments a
       set day_closed_at = null,
           updated_at = v_stamp
     where a.collector_ref = v_collector
       and a.dispatch_date = v_today
       and a.day_closed_at is not null
       and upper(btrim(coalesce(
            (select nullif(c.route, '') from public.clients c where c.ref = a.client_ref),
            a.client_route
          ))) = 'M';
    get diagnostics v_reopened = row_count;

    return jsonb_build_object(
      'ok', true,
      'date', v_today,
      'ref', '',
      'routes', jsonb_build_array('M'),
      'reopened_visits', greatest(v_reopened, v_skipped),
      'reopens', jsonb_build_array(
        jsonb_build_object(
          'route', 'M',
          'at', v_at,
          'by', v_by,
          'closeRef', '',
          'collectorRef', v_collector,
          'date', v_today::text
        )
      )
    );
  end if;

  -- Con CIE-: bloqueo si ya hay ajuste de saldo de T (AJUSTE: sin @).
  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
    where e like 'AJUSTE:%' and e not like 'AJUSTE@%'
  ) into v_has_ajuste;
  if v_has_ajuste then
    return jsonb_build_object('ok', false, 'error', 'saldo_ajustado');
  end if;

  -- ¿La ruta pedida ya tiene REABIERTA viva (at >= closed_at)?
  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
    where e like ('REABIERTA@' || v_route || ':%')
      and (
        v_cie.closed_at is null
        or split_part(substring(e from length('REABIERTA@' || v_route || ':') + 1), '|', 1)::timestamptz
          >= v_cie.closed_at
      )
  ) into v_route_live;
  if v_route_live then
    return jsonb_build_object('ok', false, 'error', 'ya_reabierta');
  end if;

  -- M + T solo si T sigue cerrada por el CIE (sin REABIERTA@T viva).
  if v_route = 'M' then
    select exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
      where e like 'REABIERTA@T:%'
        and (
          v_cie.closed_at is null
          or split_part(substring(e from length('REABIERTA@T:') + 1), '|', 1)::timestamptz
            >= v_cie.closed_at
        )
    ) into v_t_live;
    if v_t_live then
      v_routes := array['M'];
    else
      v_routes := array['M', 'T'];
    end if;
  else
    v_routes := array[v_route];
  end if;

  -- Marca con hora ≥ closed_at (si no, el pull la trata como vieja).
  v_stamp := greatest(v_stamp, coalesce(v_cie.closed_at, v_stamp) + interval '1 millisecond');
  v_at := to_char(timezone('UTC', v_stamp), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_close_ref := v_cie.ref;

  foreach v_target in array v_routes
  loop
    v_markers := v_markers || jsonb_build_array(
      'REABIERTA@' || v_target || ':' || v_at || '|' || replace(v_by, '|', '/')
    );
    v_reopens := v_reopens || jsonb_build_array(
      jsonb_build_object(
        'route', v_target,
        'at', v_at,
        'by', v_by,
        'closeRef', v_close_ref,
        'collectorRef', v_collector,
        'date', v_today::text
      )
    );
  end loop;

  v_refs := coalesce(v_cie.movement_refs, '[]'::jsonb) || v_markers;
  if v_key <> '' then
    v_refs := v_refs || jsonb_build_array('REOPEN_KEY:' || v_key);
  end if;

  update public.day_closes
     set movement_refs = v_refs,
         updated_at = v_stamp
   where ref = v_cie.ref;

  update public.daily_assignments a
     set visit_status = 'pendiente',
         skip_reason = null,
         day_closed_at = null,
         updated_at = v_stamp
   where a.collector_ref = v_collector
     and a.dispatch_date = v_today
     and upper(btrim(coalesce(
          (select nullif(c.route, '') from public.clients c where c.ref = a.client_ref),
          a.client_route
        ))) = any (v_routes)
     and a.visit_status = 'omitido'
     and a.skip_reason = 'Cierre de jornada'
     and coalesce(nullif(btrim(a.payment_ref), ''), '') = '';
  get diagnostics v_skipped = row_count;

  update public.daily_assignments a
     set day_closed_at = null,
         updated_at = v_stamp
   where a.collector_ref = v_collector
     and a.dispatch_date = v_today
     and a.day_closed_at is not null
     and upper(btrim(coalesce(
          (select nullif(c.route, '') from public.clients c where c.ref = a.client_ref),
          a.client_route
        ))) = any (v_routes);
  get diagnostics v_reopened = row_count;

  return jsonb_build_object(
    'ok', true,
    'date', v_today,
    'ref', v_close_ref,
    'routes', to_jsonb(v_routes),
    'reopened_visits', greatest(v_reopened, v_skipped),
    'reopens', v_reopens
  );
end;
$function$;

comment on function public.reopen_day_sheet(text, text, text, text) is
  'Fase 4.4: reabre hoja de hoy. Marca REABIERTA@ + suelta day_closed_at. Atómica.';

revoke all on function public.reopen_day_sheet(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reopen_day_sheet(text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
