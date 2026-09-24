-- Cobro atómico: idempotencia con payload original, tope de saldo, combinado en una sola tx.
-- Compatible con register_collection existente (misma firma + respuesta enriquecida).

create or replace function public.payment_row_json(p public.payments)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id,
    'ref', p.ref,
    'loan_ref', p.loan_ref,
    'client_ref', p.client_ref,
    'collector_ref', p.collector_ref,
    'collector_name', p.collector_name,
    'amount', trunc(p.amount),
    'paid_date', p.paid_date,
    'paid_time', p.paid_time,
    'due_date', p.due_date,
    'charge_label', p.charge_label,
    'method', p.method,
    'source', p.source,
    'payment_type', p.payment_type,
    'payment_kind', p.payment_kind,
    'route_ref', p.route_ref,
    'evidence', p.evidence,
    'idempotency_key', p.idempotency_key,
    'updated_at', p.updated_at
  );
$$;

create or replace function public.loan_open_balance(p_loan_ref text)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric(14, 2);
  v_paid numeric(14, 2);
begin
  select trunc(coalesce(total, capital + coalesce(interest, 0), 0))
    into v_total
  from public.loans
  where ref = p_loan_ref;

  if not found then
    return null;
  end if;

  v_paid := public.loan_collected(p_loan_ref);
  return greatest(0, v_total - v_paid);
end;
$$;

create or replace function public.register_collection(
  p_ref text,
  p_loan_ref text,
  p_amount numeric,
  p_paid_date date,
  p_method text,
  p_idempotency_key text default null,
  p_client_ref text default null,
  p_collector_ref text default null,
  p_collector_name text default null,
  p_paid_time text default null,
  p_due_date date default null,
  p_charge_label text default null,
  p_source text default 'pwa',
  p_payment_type text default null,
  p_payment_kind text default null,
  p_route_ref text default null,
  p_evidence jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_amount numeric(14, 2) := trunc(p_amount);
  v_existing public.payments%rowtype;
  v_paid numeric(14, 2);
  v_total numeric(14, 2);
  v_balance numeric(14, 2);
  v_open numeric(14, 2);
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
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ref', v_existing.ref,
      'payment', public.payment_row_json(v_existing)
    );
  end if;

  -- Bloqueo de fila del préstamo: evita carrera entre dos cobros concurrentes.
  select trunc(coalesce(total, capital + coalesce(interest, 0), 0))
    into v_total
  from public.loans
  where ref = p_loan_ref
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409);
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
      nullif(btrim(coalesce(p_client_ref, '')), ''),
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
        return jsonb_build_object(
          'ok', true,
          'duplicate', true,
          'ref', v_existing.ref,
          'payment', public.payment_row_json(v_existing)
        );
      end if;
      return jsonb_build_object('ok', false, 'error', 'conflicto_unico', 'code', 409);
  end;

  v_paid := public.loan_collected(p_loan_ref);

  update public.loans l
  set
    paid = v_paid,
    balance = greatest(0, trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid),
    status = case
      when trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid <= 0
        then 'Finalizado'
      when l.status = 'Finalizado' then 'Activo'
      else l.status
    end,
    updated_at = now()
  where l.ref = p_loan_ref
  returning
    trunc(coalesce(total, capital + coalesce(interest, 0), 0)),
    balance
  into v_total, v_balance;

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
$$;

comment on function public.register_collection(
  text, text, numeric, date, text, text, text, text, text, text, date, text, text, text, text, text, jsonb
) is
  'Inserta un PG- y recalcula saldo. Misma idempotency_key → 200 idempotente con el pago original. No supera saldo.';

-- Parte de un combinado (jsonb) → registro interno sin commit intermedio de saldo final.
create or replace function public._insert_collection_part(p_part jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_ref text := nullif(btrim(coalesce(p_part->>'ref', '')), '');
  v_loan text := nullif(btrim(coalesce(p_part->>'loan_ref', '')), '');
  v_amount numeric(14, 2) := trunc(coalesce((p_part->>'amount')::numeric, 0));
  v_method text := nullif(btrim(coalesce(p_part->>'method', '')), '');
  v_key text := nullif(btrim(coalesce(p_part->>'idempotency_key', '')), '');
  v_paid_date date := nullif(btrim(coalesce(p_part->>'paid_date', '')), '')::date;
  v_existing public.payments%rowtype;
begin
  if v_ref is null or v_ref !~ '^PG-' then
    return jsonb_build_object('ok', false, 'error', 'ref_invalida', 'code', 400);
  end if;
  if v_loan is null then
    return jsonb_build_object('ok', false, 'error', 'prestamo_invalido', 'code', 400);
  end if;
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'monto_invalido', 'code', 400);
  end if;
  if v_method not in ('efectivo', 'nequi', 'banco') then
    return jsonb_build_object('ok', false, 'error', 'metodo_invalido', 'code', 400);
  end if;
  if v_paid_date is null then
    return jsonb_build_object('ok', false, 'error', 'fecha_invalida', 'code', 400);
  end if;

  select *
    into v_existing
  from public.payments
  where ref = v_ref
     or (v_key is not null and idempotency_key = v_key)
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ref', v_existing.ref,
      'payment', public.payment_row_json(v_existing)
    );
  end if;

  insert into public.payments (
    ref, loan_ref, client_ref, collector_ref, collector_name,
    amount, paid_date, paid_time, due_date, charge_label,
    method, source, payment_type, payment_kind, route_ref,
    evidence, idempotency_key
  ) values (
    v_ref,
    v_loan,
    nullif(btrim(coalesce(p_part->>'client_ref', '')), ''),
    nullif(btrim(coalesce(p_part->>'collector_ref', '')), ''),
    nullif(btrim(coalesce(p_part->>'collector_name', '')), ''),
    v_amount,
    v_paid_date,
    nullif(btrim(coalesce(p_part->>'paid_time', '')), ''),
    nullif(btrim(coalesce(p_part->>'due_date', '')), '')::date,
    nullif(btrim(coalesce(p_part->>'charge_label', '')), ''),
    v_method,
    coalesce(nullif(btrim(coalesce(p_part->>'source', '')), ''), 'pwa'),
    nullif(btrim(coalesce(p_part->>'payment_type', '')), ''),
    nullif(btrim(coalesce(p_part->>'payment_kind', '')), ''),
    nullif(btrim(coalesce(p_part->>'route_ref', '')), ''),
    case when p_part ? 'evidence' then p_part->'evidence' else null end,
    v_key
  )
  returning * into v_existing;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'ref', v_existing.ref,
    'payment', public.payment_row_json(v_existing)
  );
exception
  when unique_violation then
    select *
      into v_existing
    from public.payments
    where ref = v_ref
       or (v_key is not null and idempotency_key = v_key)
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'ref', v_existing.ref,
        'payment', public.payment_row_json(v_existing)
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'conflicto_unico', 'code', 409);
end;
$$;

/**
 * Dos PG- del mismo comboGroupId en una sola transacción.
 * Si falla el 2.º tramo, se hace rollback completo (nada queda a medias).
 */
create or replace function public.register_combined_collection(
  p_part_a jsonb,
  p_part_b jsonb
)
returns jsonb
language plpgsql
as $$
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

  -- Si ambos ya existían (reintento), no recalcular de más; si al menos uno es nuevo, sí.
  v_paid := public.loan_collected(v_loan);
  update public.loans l
  set
    paid = v_paid,
    balance = greatest(0, trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid),
    status = case
      when trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid <= 0
        then 'Finalizado'
      when l.status = 'Finalizado' then 'Activo'
      else l.status
    end,
    updated_at = now()
  where l.ref = v_loan
  returning balance into v_balance;

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
    -- Cualquier fallo → rollback de la función (ambas partes).
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', 500
    );
end;
$$;

comment on function public.register_combined_collection(jsonb, jsonb) is
  'Dos PG- combinados en una sola transacción. Fallo de un tramo = rollback total.';

grant execute on function public.payment_row_json(public.payments) to anon, authenticated, service_role;
grant execute on function public.loan_open_balance(text) to anon, authenticated, service_role;
grant execute on function public.register_collection(
  text, text, numeric, date, text, text, text, text, text, text, date, text, text, text, text, text, jsonb
) to anon, authenticated, service_role;
grant execute on function public._insert_collection_part(jsonb)
  to anon, authenticated, service_role;
grant execute on function public.register_combined_collection(jsonb, jsonb)
  to anon, authenticated, service_role;
