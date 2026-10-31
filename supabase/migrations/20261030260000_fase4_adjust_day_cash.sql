-- Fase 4 · corte 4.3 — ajuste de saldo por orden (T, A, N, pools).
-- T: cash_float = real (Inicial M mañana). A/N/pools: AJUSTE@ruta (no toca cash_float de la cadena).

create or replace function public.adjust_day_cash(
  p_collector_ref text,
  p_date date,
  p_real numeric,
  p_by text,
  p_reason text,
  p_route text default null,
  p_key text default null,
  p_calculated numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route text := upper(btrim(coalesce(p_route, '')));
  v_key text := btrim(coalesce(p_key, ''));
  v_ref text;
  v_cie record;
  v_today date := (timezone('America/Bogota', now()))::date;
  v_calc numeric(14, 2);
  v_real numeric(14, 2);
  v_entry text;
  v_mark text;
  v_refs jsonb;
  v_at text := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_by text := btrim(coalesce(p_by, ''));
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
begin
  if p_collector_ref is null or btrim(p_collector_ref) = '' or p_date is null then
    return jsonb_build_object('ok', false, 'error', 'dato_invalido');
  end if;
  if p_date <> v_today then
    return jsonb_build_object('ok', false, 'error', 'solo_hoy');
  end if;
  if p_real is null or p_real < 0 or trunc(p_real) <> p_real then
    return jsonb_build_object('ok', false, 'error', 'monto_invalido');
  end if;
  if length(v_by) < 1 then
    return jsonb_build_object('ok', false, 'error', 'sin_quien');
  end if;
  if length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'error', 'sin_motivo');
  end if;
  if v_route <> '' and v_route not in ('A', 'N', 'POOL-BANCO', 'POOL-NEQUI') then
    return jsonb_build_object('ok', false, 'error', 'ruta_invalida');
  end if;

  v_real := trunc(p_real);
  v_ref := 'CIE-' || btrim(p_collector_ref) || '-' || to_char(p_date, 'YYYYMMDD');

  select * into v_cie
  from public.day_closes d
  where d.ref = v_ref
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sin_cie');
  end if;

  if v_key <> '' then
    v_mark := 'ADJ_KEY:' || v_key;
    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
      where e = v_mark
    ) then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'ref', v_cie.ref,
        'cash_float', v_cie.cash_float,
        'real', v_real,
        'route', nullif(v_route, '')
      );
    end if;
  end if;

  if v_route = '' then
    select nullif(split_part(split_part(entry, ':', 2), '|', 1), '')::numeric
      into v_calc
    from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) as entry
    where entry like 'AJUSTE:%'
      and entry not like 'AJUSTE@%'
    order by split_part(split_part(entry, ':', 2), '|', 3) desc
    limit 1;
    v_calc := trunc(coalesce(v_calc, p_calculated, v_cie.cash_float));
    if v_calc = v_real and v_calc = trunc(v_cie.cash_float) and not exists (
      select 1 from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
      where e like 'AJUSTE:%' and e not like 'AJUSTE@%'
    ) then
      return jsonb_build_object('ok', false, 'error', 'sin_diferencia');
    end if;

    v_entry := 'AJUSTE:' || v_calc::text || '|' || v_real::text || '|' ||
      replace(v_at, '|', '/') || '|' ||
      replace(v_by, '|', '/') || '|' ||
      replace(v_reason, '|', '/');

    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
      into v_refs
    from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
    where e not like 'AJUSTE:%' or e like 'AJUSTE@%';

    v_refs := v_refs || jsonb_build_array(v_entry);
    if v_key <> '' then
      v_refs := v_refs || jsonb_build_array(v_mark);
    end if;

    update public.day_closes
       set cash_float = v_real,
           movement_refs = v_refs,
           updated_at = now()
     where ref = v_ref;

    return jsonb_build_object(
      'ok', true,
      'ref', v_ref,
      'cash_float', v_real,
      'calculated', v_calc,
      'real', v_real,
      'route', null
    );
  end if;

  -- A / N / pools: no cambian cash_float de la cadena.
  select nullif(split_part(split_part(entry, ':', 2), '|', 1), '')::numeric
    into v_calc
  from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) as entry
  where entry like ('AJUSTE@' || v_route || ':%')
  order by split_part(split_part(entry, ':', 2), '|', 3) desc
  limit 1;
  v_calc := trunc(coalesce(v_calc, p_calculated, 0));

  v_entry := 'AJUSTE@' || v_route || ':' || v_calc::text || '|' || v_real::text || '|' ||
    replace(v_at, '|', '/') || '|' ||
    replace(v_by, '|', '/') || '|' ||
    replace(v_reason, '|', '/');

  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
    into v_refs
  from jsonb_array_elements_text(coalesce(v_cie.movement_refs, '[]'::jsonb)) e
  where e not like ('AJUSTE@' || v_route || ':%');

  v_refs := v_refs || jsonb_build_array(v_entry);
  if v_key <> '' then
    v_refs := v_refs || jsonb_build_array(v_mark);
  end if;

  update public.day_closes
     set movement_refs = v_refs,
         updated_at = now()
   where ref = v_ref;

  return jsonb_build_object(
    'ok', true,
    'ref', v_ref,
    'cash_float', v_cie.cash_float,
    'calculated', v_calc,
    'real', v_real,
    'route', v_route
  );
end;
$function$;

comment on function public.adjust_day_cash(text, date, numeric, text, text, text, text, numeric) is
  'Fase 4.3: ajuste de saldo T/A/N/pools. Solo hoy. T escribe cash_float; A/N solo AJUSTE@ruta.';

revoke all on function public.adjust_day_cash(text, date, numeric, text, text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.adjust_day_cash(text, date, numeric, text, text, text, text, numeric)
  to service_role;

notify pgrst, 'reload schema';
