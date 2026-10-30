-- Fase 2 · corte 2.1 — el cobro dueña la visita y el Prestar al liquidar.
-- Misma transacción que register_collection / register_combined_collection.
-- No toca CIE, caja ni días cerrados (historia sagrada / hoja diaria).

-- 1) Sella la cuota abierta del día del cobro (no Prestar, no hoja cerrada).
create or replace function public._seal_visit_after_collection(
  p_loan_ref text,
  p_payment_ref text,
  p_paid_date date,
  p_collector_ref text default null
)
returns void
language plpgsql
as $$
declare
  v_loan text := nullif(btrim(coalesce(p_loan_ref, '')), '');
  v_pay text := nullif(btrim(coalesce(p_payment_ref, '')), '');
begin
  if v_loan is null or v_pay is null or p_paid_date is null then
    return;
  end if;

  update public.daily_assignments
  set
    visit_status = 'cobrado',
    payment_ref = v_pay,
    amount_due = 0,
    alert_count = 0,
    loan_ref = coalesce(nullif(btrim(loan_ref), ''), v_loan)
  where loan_ref = v_loan
    and dispatch_date = p_paid_date
    and (day_closed_at is null or btrim(day_closed_at) = '')
    and coalesce(awaiting_loan, false) = false
    and coalesce(visit_status, 'pendiente') in ('pendiente', 'parcial')
    and (
      p_collector_ref is null
      or nullif(btrim(p_collector_ref), '') is null
      or collector_ref = btrim(p_collector_ref)
      or nullif(btrim(collector_ref), '') is null
    );
end;
$$;

comment on function public._seal_visit_after_collection(text, text, date, text) is
  'Fase 2.1: marca cobrada la visita abierta del préstamo en el día del PG-. No toca días cerrados ni Prestar.';

-- 2) Si el saldo quedó en 0 y la hoja sigue abierta → abre Prestar (una fila).
create or replace function public._open_prestar_after_paid_off(
  p_loan_ref text,
  p_paid_date date,
  p_collector_ref text default null,
  p_collector_name text default null
)
returns void
language plpgsql
as $$
declare
  v_loan public.loans%rowtype;
  v_client text;
  v_route text;
  v_name text;
  v_address text;
  v_cob text;
  v_cob_name text;
  v_item text;
  v_n integer;
  v_n_closed integer;
begin
  if nullif(btrim(coalesce(p_loan_ref, '')), '') is null or p_paid_date is null then
    return;
  end if;

  select * into v_loan from public.loans where ref = btrim(p_loan_ref);
  if not found then
    return;
  end if;
  if trunc(coalesce(v_loan.balance, 0)) > 0 then
    return;
  end if;

  v_client := nullif(btrim(coalesce(v_loan.client_ref, '')), '');
  if v_client is null then
    return;
  end if;

  -- Otro préstamo activo del mismo cliente → no ofrecer Prestar.
  if exists (
    select 1
    from public.loans l
    where l.client_ref = v_client
      and l.ref <> v_loan.ref
      and l.deleted_at is null
      and lower(btrim(coalesce(l.status, ''))) not in ('finalizado', 'eliminado', 'cancelado')
  ) then
    return;
  end if;

  select
    nullif(btrim(coalesce(c.route, '')), ''),
    coalesce(nullif(btrim(coalesce(c.name, '')), ''), nullif(btrim(coalesce(v_loan.client_name, '')), ''), v_client),
    c.address
  into v_route, v_name, v_address
  from public.clients c
  where c.ref = v_client;

  if v_name is null then
    v_name := coalesce(nullif(btrim(coalesce(v_loan.client_name, '')), ''), v_client);
  end if;

  v_cob := nullif(btrim(coalesce(p_collector_ref, '')), '');
  v_cob_name := nullif(btrim(coalesce(p_collector_name, '')), '');
  if v_cob is null then
    select da.collector_ref, da.collector_name
      into v_cob, v_cob_name
    from public.daily_assignments da
    where da.dispatch_date = p_paid_date
      and da.client_ref = v_client
      and nullif(btrim(da.collector_ref), '') is not null
    order by case when coalesce(da.awaiting_loan, false) then 1 else 0 end,
             da.updated_at desc nulls last
    limit 1;
  end if;
  if v_cob is null then
    return;
  end if;

  -- Hoja de esa ruta ya cerrada → no abrir Prestar (hoja-diaria).
  select
    count(*)::integer,
    count(*) filter (
      where day_closed_at is not null and btrim(day_closed_at) <> ''
    )::integer
  into v_n, v_n_closed
  from public.daily_assignments
  where dispatch_date = p_paid_date
    and collector_ref = v_cob
    and (
      v_route is null
      or btrim(coalesce(client_route, '')) = v_route
    );
  if v_n > 0 and v_n = v_n_closed then
    return;
  end if;

  v_item := to_char(p_paid_date, 'YYYY-MM-DD') || ':' || v_client || ':prestar';

  -- Ya hay Prestar abierta → no duplicar.
  if exists (
    select 1
    from public.daily_assignments
    where dispatch_date = p_paid_date
      and item_id = v_item
      and (day_closed_at is null or btrim(day_closed_at) = '')
      and coalesce(skip_reason, '') <> 'Préstamo hecho hoy'
      and coalesce(visit_status, 'pendiente') in ('pendiente', 'parcial')
  ) then
    return;
  end if;

  -- Todavía hay cuota abierta de ese cliente → no abrir Prestar todavía.
  if exists (
    select 1
    from public.daily_assignments
    where dispatch_date = p_paid_date
      and client_ref = v_client
      and collector_ref = v_cob
      and coalesce(awaiting_loan, false) = false
      and nullif(btrim(loan_ref), '') is not null
      and (day_closed_at is null or btrim(day_closed_at) = '')
      and coalesce(visit_status, 'pendiente') in ('pendiente', 'parcial')
  ) then
    return;
  end if;

  insert into public.daily_assignments (
    item_id,
    dispatch_date,
    loan_ref,
    client_ref,
    client_name,
    client_route,
    address,
    charge_date,
    amount_due,
    charge_label,
    kind,
    collector_ref,
    collector_name,
    assigned_at,
    dispatched,
    dispatched_at,
    visit_status,
    skip_reason,
    payment_ref,
    alert_count,
    awaiting_loan
  ) values (
    v_item,
    p_paid_date,
    '',
    v_client,
    v_name,
    coalesce(v_route, ''),
    v_address,
    to_char(p_paid_date, 'YYYY-MM-DD'),
    0,
    'Prestar',
    'cuota',
    v_cob,
    coalesce(v_cob_name, ''),
    now()::text,
    true,
    now()::text,
    'pendiente',
    null,
    null,
    0,
    true
  )
  on conflict (dispatch_date, item_id) do update
  set
    visit_status = case
      when public.daily_assignments.skip_reason = 'Préstamo hecho hoy' then public.daily_assignments.visit_status
      when public.daily_assignments.day_closed_at is not null
        and btrim(public.daily_assignments.day_closed_at) <> '' then public.daily_assignments.visit_status
      else 'pendiente'
    end,
    skip_reason = case
      when public.daily_assignments.skip_reason = 'Préstamo hecho hoy' then public.daily_assignments.skip_reason
      when public.daily_assignments.day_closed_at is not null
        and btrim(public.daily_assignments.day_closed_at) <> '' then public.daily_assignments.skip_reason
      else null
    end,
    awaiting_loan = true,
    loan_ref = '',
    amount_due = 0,
    charge_label = 'Prestar',
    payment_ref = case
      when public.daily_assignments.skip_reason = 'Préstamo hecho hoy' then public.daily_assignments.payment_ref
      else null
    end,
    dispatched = true,
    dispatched_at = coalesce(public.daily_assignments.dispatched_at, excluded.dispatched_at),
    collector_ref = coalesce(nullif(btrim(public.daily_assignments.collector_ref), ''), excluded.collector_ref),
    collector_name = coalesce(nullif(btrim(public.daily_assignments.collector_name), ''), excluded.collector_name),
    client_name = coalesce(nullif(btrim(public.daily_assignments.client_name), ''), excluded.client_name),
    client_route = coalesce(nullif(btrim(public.daily_assignments.client_route), ''), excluded.client_route),
    updated_at = now()
  where public.daily_assignments.skip_reason is distinct from 'Préstamo hecho hoy'
    and (
      public.daily_assignments.day_closed_at is null
      or btrim(public.daily_assignments.day_closed_at) = ''
    );
end;
$$;

comment on function public._open_prestar_after_paid_off(text, date, text, text) is
  'Fase 2.1: si liquidó y la hoja sigue abierta, abre Prestar. No rearma la ruta.';

revoke all on function public._seal_visit_after_collection(text, text, date, text)
  from public, anon, authenticated;
grant execute on function public._seal_visit_after_collection(text, text, date, text)
  to service_role;

revoke all on function public._open_prestar_after_paid_off(text, date, text, text)
  from public, anon, authenticated;
grant execute on function public._open_prestar_after_paid_off(text, date, text, text)
  to service_role;

-- 3) register_collection: tras _loan_settle, sella visita y abre Prestar si aplica.
CREATE OR REPLACE FUNCTION public.register_collection(
  p_ref text,
  p_loan_ref text,
  p_amount numeric,
  p_paid_date date,
  p_method text,
  p_idempotency_key text DEFAULT NULL::text,
  p_client_ref text DEFAULT NULL::text,
  p_collector_ref text DEFAULT NULL::text,
  p_collector_name text DEFAULT NULL::text,
  p_paid_time text DEFAULT NULL::text,
  p_due_date date DEFAULT NULL::date,
  p_charge_label text DEFAULT NULL::text,
  p_source text DEFAULT 'pwa'::text,
  p_payment_type text DEFAULT NULL::text,
  p_payment_kind text DEFAULT NULL::text,
  p_route_ref text DEFAULT NULL::text,
  p_evidence jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_amount numeric(14, 2) := trunc(p_amount);
  v_existing public.payments%rowtype;
  v_paid numeric(14, 2);
  v_total numeric(14, 2);
  v_balance numeric(14, 2);
  v_open numeric(14, 2);
  v_settled public.loans%rowtype;
  v_client_ref text := nullif(btrim(coalesce(p_client_ref, '')), '');
begin
  if p_ref is null or btrim(p_ref) = '' or p_ref !~ '^PG-' then
    return jsonb_build_object('ok', false, 'error', 'ref_invalida', 'code', 400);
  end if;
  if p_loan_ref is null or btrim(p_loan_ref) = '' then
    return jsonb_build_object('ok', false, 'error', 'prestamo_invalido', 'code', 400);
  end if;
  if v_amount is null or v_amount <= 0 or coalesce(p_amount, 0) <> trunc(coalesce(p_amount, 0)) then
    return jsonb_build_object('ok', false, 'error', 'monto_invalido', 'code', 400);
  end if;
  if p_method not in ('efectivo', 'nequi', 'banco') then
    return jsonb_build_object('ok', false, 'error', 'metodo_invalido', 'code', 400);
  end if;
  if p_paid_date is null then
    return jsonb_build_object('ok', false, 'error', 'fecha_invalida', 'code', 400);
  end if;

  select *
    into v_existing
  from public.payments
  where ref = p_ref
     or (v_key is not null and idempotency_key = v_key)
  limit 1;

  if found then
    -- Reintento: sana planilla (sello + Prestar) sin duplicar el PG-.
    v_settled := public._loan_settle(v_existing.loan_ref);
    perform public._seal_visit_after_collection(
      v_existing.loan_ref,
      v_existing.ref,
      v_existing.paid_date,
      v_existing.collector_ref
    );
    if trunc(coalesce(v_settled.balance, 0)) <= 0 then
      perform public._open_prestar_after_paid_off(
        v_existing.loan_ref,
        v_existing.paid_date,
        v_existing.collector_ref,
        v_existing.collector_name
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ref', v_existing.ref,
      'paid', v_settled.paid,
      'balance', v_settled.balance,
      'payment', public.payment_row_json(v_existing)
    );
  end if;

  select trunc(coalesce(total, capital + coalesce(interest, 0), 0))
    into v_total
  from public.loans
  where ref = p_loan_ref
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409);
  end if;

  if v_client_ref is null then
    select nullif(btrim(client_ref), '') into v_client_ref
    from public.loans
    where ref = p_loan_ref;
  end if;

  v_open := greatest(0, v_total - public.loan_collected(p_loan_ref));
  if v_amount > v_open then
    return jsonb_build_object(
      'ok', false,
      'error', 'saldo_excedido',
      'code', 409,
      'balance', v_open,
      'amount', v_amount
    );
  end if;

  begin
    insert into public.payments (
      ref, loan_ref, client_ref, collector_ref, collector_name,
      amount, paid_date, paid_time, due_date, charge_label,
      method, source, payment_type, payment_kind, route_ref,
      evidence, idempotency_key
    ) values (
      p_ref,
      p_loan_ref,
      v_client_ref,
      nullif(btrim(coalesce(p_collector_ref, '')), ''),
      nullif(btrim(coalesce(p_collector_name, '')), ''),
      v_amount,
      p_paid_date,
      p_paid_time,
      p_due_date,
      p_charge_label,
      p_method,
      coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'pwa'),
      p_payment_type,
      p_payment_kind,
      nullif(btrim(coalesce(p_route_ref, '')), ''),
      p_evidence,
      v_key
    )
    returning * into v_existing;
  exception
    when unique_violation then
      select *
        into v_existing
      from public.payments
      where ref = p_ref
         or (v_key is not null and idempotency_key = v_key)
      limit 1;
      if found then
        v_settled := public._loan_settle(v_existing.loan_ref);
        perform public._seal_visit_after_collection(
          v_existing.loan_ref,
          v_existing.ref,
          v_existing.paid_date,
          v_existing.collector_ref
        );
        if trunc(coalesce(v_settled.balance, 0)) <= 0 then
          perform public._open_prestar_after_paid_off(
            v_existing.loan_ref,
            v_existing.paid_date,
            v_existing.collector_ref,
            v_existing.collector_name
          );
        end if;
        return jsonb_build_object(
          'ok', true,
          'duplicate', true,
          'ref', v_existing.ref,
          'paid', v_settled.paid,
          'balance', v_settled.balance,
          'payment', public.payment_row_json(v_existing)
        );
      end if;
      return jsonb_build_object('ok', false, 'error', 'conflicto_unico', 'code', 409);
  end;

  v_paid := public.loan_collected(p_loan_ref);
  v_settled := public._loan_settle(p_loan_ref);
  v_total := trunc(coalesce(v_settled.total, v_settled.capital + coalesce(v_settled.interest, 0), 0));
  v_balance := v_settled.balance;

  perform public._seal_visit_after_collection(
    p_loan_ref,
    v_existing.ref,
    p_paid_date,
    v_existing.collector_ref
  );
  if trunc(coalesce(v_balance, 0)) <= 0 then
    perform public._open_prestar_after_paid_off(
      p_loan_ref,
      p_paid_date,
      v_existing.collector_ref,
      v_existing.collector_name
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'ref', v_existing.ref,
    'paid', v_paid,
    'total', v_total,
    'balance', v_balance,
    'payment', public.payment_row_json(v_existing)
  );
end;
$function$;

comment on function public.register_collection(
  text, text, numeric, date, text, text, text, text, text, text, date, text, text, text, text, text, jsonb
) is
  'Cobro atómico: PG- + saldo + sella visita del día + Prestar si liquidó (Fase 2.1).';

-- 4) Combinado: misma regla al final (un solo sello / un Prestar).
CREATE OR REPLACE FUNCTION public.register_combined_collection(p_part_a jsonb, p_part_b jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
declare
  v_loan text;
  v_loan_b text;
  v_method_a text;
  v_method_b text;
  v_amount_a numeric(14, 2);
  v_amount_b numeric(14, 2);
  v_total numeric(14, 2);
  v_open numeric(14, 2);
  v_paid numeric(14, 2);
  v_balance numeric(14, 2);
  v_res_a jsonb;
  v_res_b jsonb;
  v_dup_a boolean;
  v_dup_b boolean;
  v_paid_date date;
  v_collector text;
  v_collector_name text;
  v_pay_ref text;
begin
  if p_part_a is null or p_part_b is null then
    return jsonb_build_object('ok', false, 'error', 'partes_requeridas', 'code', 400);
  end if;

  v_loan := nullif(btrim(coalesce(p_part_a->>'loan_ref', '')), '');
  v_loan_b := nullif(btrim(coalesce(p_part_b->>'loan_ref', '')), '');
  if v_loan is null or v_loan_b is null or v_loan <> v_loan_b then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inconsistente', 'code', 400);
  end if;

  v_method_a := nullif(btrim(coalesce(p_part_a->>'method', '')), '');
  v_method_b := nullif(btrim(coalesce(p_part_b->>'method', '')), '');
  if v_method_a is null or v_method_b is null or v_method_a = v_method_b then
    return jsonb_build_object('ok', false, 'error', 'metodos_iguales', 'code', 400);
  end if;

  v_amount_a := trunc(coalesce((p_part_a->>'amount')::numeric, 0));
  v_amount_b := trunc(coalesce((p_part_b->>'amount')::numeric, 0));
  if v_amount_a <= 0 or v_amount_b <= 0 then
    return jsonb_build_object('ok', false, 'error', 'monto_invalido', 'code', 400);
  end if;

  select trunc(coalesce(total, capital + coalesce(interest, 0), 0))
    into v_total
  from public.loans
  where ref = v_loan
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409);
  end if;

  v_open := greatest(0, v_total - public.loan_collected(v_loan));
  if (v_amount_a + v_amount_b) > v_open then
    return jsonb_build_object(
      'ok', false,
      'error', 'saldo_excedido',
      'code', 409,
      'balance', v_open,
      'amount', v_amount_a + v_amount_b
    );
  end if;

  v_res_a := public._insert_collection_part(p_part_a);
  if coalesce((v_res_a->>'ok')::boolean, false) is not true then
    raise exception 'combo_part_a_failed:%', coalesce(v_res_a->>'error', 'error');
  end if;

  v_res_b := public._insert_collection_part(p_part_b);
  if coalesce((v_res_b->>'ok')::boolean, false) is not true then
    raise exception 'combo_part_b_failed:%', coalesce(v_res_b->>'error', 'error');
  end if;

  v_dup_a := coalesce((v_res_a->>'duplicate')::boolean, false);
  v_dup_b := coalesce((v_res_b->>'duplicate')::boolean, false);

  v_paid := public.loan_collected(v_loan);
  v_balance := (public._loan_settle(v_loan)).balance;

  v_paid_date := coalesce(
    nullif(btrim(coalesce(p_part_a->>'paid_date', '')), '')::date,
    nullif(btrim(coalesce(p_part_b->>'paid_date', '')), '')::date
  );
  v_collector := coalesce(
    nullif(btrim(coalesce(p_part_a->>'collector_ref', '')), ''),
    nullif(btrim(coalesce(p_part_b->>'collector_ref', '')), '')
  );
  v_collector_name := coalesce(
    nullif(btrim(coalesce(p_part_a->>'collector_name', '')), ''),
    nullif(btrim(coalesce(p_part_b->>'collector_name', '')), '')
  );
  v_pay_ref := coalesce(nullif(btrim(coalesce(v_res_a->>'ref', '')), ''), nullif(btrim(coalesce(v_res_b->>'ref', '')), ''));

  if v_pay_ref is not null and v_paid_date is not null then
    perform public._seal_visit_after_collection(v_loan, v_pay_ref, v_paid_date, v_collector);
    if trunc(coalesce(v_balance, 0)) <= 0 then
      perform public._open_prestar_after_paid_off(v_loan, v_paid_date, v_collector, v_collector_name);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', v_dup_a and v_dup_b,
    'refs', jsonb_build_array(v_res_a->>'ref', v_res_b->>'ref'),
    'paid', v_paid,
    'balance', v_balance,
    'payments', jsonb_build_array(v_res_a->'payment', v_res_b->'payment')
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', 500
    );
end;
$function$;

comment on function public.register_combined_collection(jsonb, jsonb) is
  'Cobro combinado atómico + sella visita + Prestar si liquidó (Fase 2.1).';

grant execute on function public.register_collection(
  text, text, numeric, date, text, text, text, text, text, text, date, text, text, text, text, text, jsonb
) to service_role;

grant execute on function public.register_combined_collection(jsonb, jsonb) to service_role;
