-- Al crear el préstamo, la visita Prestar de ese día se cierra en la misma transacción.
-- Si se deja pendiente, el celular la vuelve a ofrecer.

create or replace function public._close_prestar_after_loan(p_client text, p_start text)
returns void
language plpgsql
as $$
declare
  v_raw text := btrim(coalesce(p_start, ''));
  v_day date;
begin
  if nullif(btrim(coalesce(p_client, '')), '') is null then
    return;
  end if;
  if v_raw ~ '^\d{4}-\d{2}-\d{2}' then
    v_day := substring(v_raw from 1 for 10)::date;
  elsif v_raw ~ '^\d{2}/\d{2}/\d{4}$' then
    v_day := to_date(v_raw, 'DD/MM/YYYY');
  else
    return;
  end if;

  update public.daily_assignments
  set
    visit_status = 'omitido',
    skip_reason = 'Préstamo hecho hoy',
    awaiting_loan = true,
    loan_ref = '',
    amount_due = 0,
    alert_count = 0
  where client_ref = btrim(p_client)
    and dispatch_date = v_day
    and item_id = to_char(v_day, 'YYYY-MM-DD') || ':' || btrim(p_client) || ':prestar'
    and (day_closed_at is null or btrim(day_closed_at) = '')
    and coalesce(visit_status, 'pendiente') in ('pendiente', 'parcial');
end;
$$;

create or replace function public.create_loan(p_idempotency_key text, p_loan jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_client text := nullif(btrim(coalesce(p_loan->>'client_ref', '')), '');
  v_row public.loans%rowtype;
  v_check jsonb;
  v_invalid text;
  v_total numeric(14, 2);
begin
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'clave_requerida', 'code', 400);
  end if;

  select * into v_row from public.loans where idempotency_key = v_key;
  if found then
    perform public._close_prestar_after_loan(v_row.client_ref, v_row.start_date);
    return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
  end if;

  if v_client is null then
    return jsonb_build_object('ok', false, 'error', 'cliente_invalido', 'code', 400);
  end if;
  v_invalid := public._loan_terms_valid(p_loan);
  if v_invalid is not null then
    return jsonb_build_object('ok', false, 'error', v_invalid, 'code', 400);
  end if;

  v_check := public._lock_client_for_loan(v_client, null);
  if coalesce((v_check->>'ok')::boolean, false) is not true then
    return v_check;
  end if;

  v_total := trunc((p_loan->>'total')::numeric);

  insert into public.loans (
    ref, client_ref, client_name, start_date, due_date,
    capital, paid, balance, status, kind,
    notes, rate, frequency, mode, pact, days, interest, total, installment, schedule,
    collection_alerts, terms_pending, idempotency_key
  ) values (
    public._next_loan_ref(),
    v_client,
    coalesce(p_loan->>'client_name', ''),
    btrim(p_loan->>'start_date'),
    coalesce(p_loan->>'due_date', ''),
    trunc((p_loan->>'capital')::numeric),
    0,
    v_total,
    'Activo',
    'ok',
    p_loan->>'notes',
    (p_loan->>'rate')::numeric,
    p_loan->>'frequency',
    p_loan->>'mode',
    p_loan->>'pact',
    (p_loan->>'days')::integer,
    (p_loan->>'interest')::numeric,
    v_total,
    (p_loan->>'installment')::numeric,
    p_loan->'schedule',
    0,
    coalesce((p_loan->>'terms_pending')::boolean, false),
    v_key
  )
  returning * into v_row;

  perform public._close_prestar_after_loan(v_row.client_ref, v_row.start_date);

  return jsonb_build_object('ok', true, 'duplicate', false, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
exception
  when unique_violation then
    select * into v_row from public.loans where idempotency_key = v_key;
    if found then
      perform public._close_prestar_after_loan(v_row.client_ref, v_row.start_date);
      return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
    end if;
    return jsonb_build_object('ok', false, 'error', 'conflicto_unico', 'code', 409, 'retry', true);
end;
$$;

comment on function public.create_loan(text, jsonb) is
  'Alta atómica: asigna el P-, exige un solo préstamo activo y cierra la visita Prestar de ese día.';

revoke all on function public._close_prestar_after_loan(text, text) from public, anon, authenticated;
grant execute on function public._close_prestar_after_loan(text, text) to service_role;
