-- Fase 2 · corte 2.3 — el gasto del día lo dueña la base.
-- - Total = suma de líneas (no el número que mande el aparato).
-- - Con CIE- del cobrador ese día: no se reescribe (historia / hoja cerrada).

create or replace function public.register_day_expense(
  p_ref text,
  p_collector_ref text,
  p_collector_name text,
  p_expense_date date,
  p_route_ref text,
  p_expenses jsonb,
  p_expenses_total numeric
)
returns jsonb
language plpgsql
as $$
declare
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_cob text := nullif(btrim(coalesce(p_collector_ref, '')), '');
  v_lines jsonb := coalesce(p_expenses, '[]'::jsonb);
  v_total numeric(14, 2) := 0;
begin
  if v_ref is null then
    return jsonb_build_object('ok', false, 'error', 'ref_invalida', 'code', 400);
  end if;
  if v_cob is null then
    return jsonb_build_object('ok', false, 'error', 'cobrador_invalido', 'code', 400);
  end if;
  if p_expense_date is null then
    return jsonb_build_object('ok', false, 'error', 'fecha_invalida', 'code', 400);
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'gastos_invalidos', 'code', 400);
  end if;

  -- Día con CIE- real: gastos sellados. El aparato no los vuelve a subir.
  if exists (
    select 1
    from public.day_closes
    where collector_ref = v_cob
      and close_date = p_expense_date
      and ref like 'CIE-%'
  ) then
    return jsonb_build_object('ok', false, 'error', 'dia_sellado', 'code', 409);
  end if;

  select coalesce(
    sum(greatest(0, trunc(coalesce((elem->>'amount')::numeric, 0)))),
    0
  )
    into v_total
  from jsonb_array_elements(v_lines) as elem;

  insert into public.day_expenses (
    ref, collector_ref, collector_name, expense_date, route_ref, expenses, expenses_total
  ) values (
    v_ref,
    v_cob,
    coalesce(p_collector_name, ''),
    p_expense_date,
    coalesce(p_route_ref, ''),
    v_lines,
    v_total
  )
  on conflict (ref) do update set
    collector_ref = excluded.collector_ref,
    collector_name = excluded.collector_name,
    expense_date = excluded.expense_date,
    route_ref = excluded.route_ref,
    expenses = excluded.expenses,
    expenses_total = excluded.expenses_total,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'ref', v_ref,
    'expenses_total', v_total
  );
end;
$$;

comment on function public.register_day_expense(text, text, text, date, text, jsonb, numeric) is
  'Fase 2.3: gasto del día. Total = suma de líneas. Con CIE- del día no se reescribe.';

revoke all on function public.register_day_expense(text, text, text, date, text, jsonb, numeric)
  from public, anon, authenticated;
grant execute on function public.register_day_expense(text, text, text, date, text, jsonb, numeric)
  to service_role;

notify pgrst, 'reload schema';
