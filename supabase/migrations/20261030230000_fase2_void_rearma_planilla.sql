-- Fase 2 · corte 2.2 — anular PG- rearma la planilla en la misma transacción.
-- Espejo de 2.1: si el cobro selló / abrió Prestar, el void lo deshace (solo hoja abierta).

-- 1) Visita cobrada con ese PG- → vuelve pendiente (hoy / día del cobro, sin cierre).
create or replace function public._unseal_visit_after_void(
  p_payment_ref text,
  p_loan_ref text,
  p_paid_date date
)
returns void
language plpgsql
as $$
declare
  v_pay text := nullif(btrim(coalesce(p_payment_ref, '')), '');
  v_loan text := nullif(btrim(coalesce(p_loan_ref, '')), '');
begin
  if v_pay is null or v_loan is null or p_paid_date is null then
    return;
  end if;

  update public.daily_assignments
  set
    visit_status = 'pendiente',
    payment_ref = null,
    amount_due = greatest(coalesce(amount_due, 0), 0),
    skip_reason = null
  where payment_ref = v_pay
    and loan_ref = v_loan
    and dispatch_date = p_paid_date
    and (day_closed_at is null or btrim(day_closed_at) = '')
    and coalesce(awaiting_loan, false) = false
    and coalesce(visit_status, '') in ('cobrado', 'parcial');
end;
$$;

comment on function public._unseal_visit_after_void(text, text, date) is
  'Fase 2.2: al anular, reabre la visita del PG- si la hoja sigue abierta. No toca días cerrados.';

-- 2) Si tras anular vuelve a haber saldo → quita Prestar abierta de ese liquidado.
create or replace function public._drop_prestar_after_void(
  p_loan_ref text,
  p_paid_date date
)
returns void
language plpgsql
as $$
declare
  v_loan public.loans%rowtype;
  v_client text;
  v_item text;
begin
  if nullif(btrim(coalesce(p_loan_ref, '')), '') is null or p_paid_date is null then
    return;
  end if;

  select * into v_loan from public.loans where ref = btrim(p_loan_ref);
  if not found then
    return;
  end if;
  -- Solo si otra vez debe (el cobro ya no deja saldo 0).
  if trunc(coalesce(v_loan.balance, 0)) <= 0 then
    return;
  end if;

  v_client := nullif(btrim(coalesce(v_loan.client_ref, '')), '');
  if v_client is null then
    return;
  end if;

  v_item := to_char(p_paid_date, 'YYYY-MM-DD') || ':' || v_client || ':prestar';

  delete from public.daily_assignments
  where dispatch_date = p_paid_date
    and item_id = v_item
    and client_ref = v_client
    and coalesce(awaiting_loan, false) = true
    and (day_closed_at is null or btrim(day_closed_at) = '')
    and coalesce(skip_reason, '') <> 'Préstamo hecho hoy'
    and coalesce(visit_status, 'pendiente') in ('pendiente', 'parcial')
    and payment_ref is null;
end;
$$;

comment on function public._drop_prestar_after_void(text, date) is
  'Fase 2.2: si anular deja saldo otra vez, quita el Prestar abierto de ese día (no el «Préstamo hecho hoy»).';

revoke all on function public._unseal_visit_after_void(text, text, date)
  from public, anon, authenticated;
grant execute on function public._unseal_visit_after_void(text, text, date) to service_role;

revoke all on function public._drop_prestar_after_void(text, date)
  from public, anon, authenticated;
grant execute on function public._drop_prestar_after_void(text, date) to service_role;

-- 3) void_collection ampliado.
create or replace function public.void_collection(
  p_ref text,
  p_loan_ref text,
  p_amount numeric,
  p_paid_date date,
  p_method text,
  p_charge_label text,
  p_idempotency_key text default null,
  p_client_ref text default null,
  p_collector_ref text default null,
  p_collector_name text default null,
  p_paid_time text default null,
  p_due_date date default null,
  p_source text default null,
  p_payment_kind text default null,
  p_route_ref text default null
)
returns jsonb
language plpgsql
as $function$
declare
  v_existing public.payments%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_amount numeric(14, 2) := trunc(p_amount);
  v_loan text;
  v_settled public.loans%rowtype;
  v_paid_date date;
begin
  if p_ref is null or btrim(p_ref) = '' or p_ref !~ '^PG-' then
    return jsonb_build_object('ok', false, 'error', 'ref_invalida', 'code', 400);
  end if;
  if p_loan_ref is null or btrim(p_loan_ref) = '' then
    return jsonb_build_object('ok', false, 'error', 'prestamo_invalido', 'code', 400);
  end if;

  select *
    into v_existing
  from public.payments
  where ref = btrim(p_ref)
  for update;

  if found then
    update public.payments
      set payment_type = 'Anulado',
          charge_label = p_charge_label,
          updated_at = now()
    where ref = v_existing.ref
    returning * into v_existing;
  else
    if v_amount is null or v_amount <= 0 then
      return jsonb_build_object('ok', false, 'error', 'monto_invalido', 'code', 400);
    end if;
    if p_paid_date is null then
      return jsonb_build_object('ok', false, 'error', 'fecha_invalida', 'code', 400);
    end if;

    begin
      insert into public.payments (
        ref, loan_ref, client_ref, collector_ref, collector_name,
        amount, paid_date, paid_time, due_date, charge_label,
        method, source, payment_type, payment_kind, route_ref,
        idempotency_key, updated_at
      ) values (
        btrim(p_ref),
        btrim(p_loan_ref),
        nullif(btrim(coalesce(p_client_ref, '')), ''),
        nullif(btrim(coalesce(p_collector_ref, '')), ''),
        nullif(btrim(coalesce(p_collector_name, '')), ''),
        v_amount,
        p_paid_date,
        p_paid_time,
        p_due_date,
        p_charge_label,
        coalesce(nullif(btrim(coalesce(p_method, '')), ''), 'efectivo'),
        coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'ruta'),
        'Anulado',
        p_payment_kind,
        nullif(btrim(coalesce(p_route_ref, '')), ''),
        v_key,
        now()
      )
      returning * into v_existing;
    exception
      when unique_violation then
        select *
          into v_existing
        from public.payments
        where ref = btrim(p_ref)
        for update;
        if not found then
          return jsonb_build_object('ok', false, 'error', 'conflicto_unico', 'code', 409);
        end if;
        update public.payments
          set payment_type = 'Anulado',
              charge_label = p_charge_label,
              updated_at = now()
        where ref = v_existing.ref
        returning * into v_existing;
    end;
  end if;

  v_loan := v_existing.loan_ref;
  v_paid_date := v_existing.paid_date;
  v_settled := public._loan_settle(v_loan);

  perform public._unseal_visit_after_void(v_existing.ref, v_loan, v_paid_date);
  perform public._drop_prestar_after_void(v_loan, v_paid_date);

  return jsonb_build_object(
    'ok', true,
    'ref', v_existing.ref,
    'loan_ref', v_loan,
    'balance', v_settled.balance
  );
end;
$function$;

revoke all on function public.void_collection(
  text, text, numeric, date, text, text, text, text, text, text, text, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.void_collection(
  text, text, numeric, date, text, text, text, text, text, text, text, date, text, text, text
) to service_role;

comment on function public.void_collection(
  text, text, numeric, date, text, text, text, text, text, text, text, date, text, text, text
) is
  'Anula PG- + saldo + rearma visita / quita Prestar si vuelve a deber (Fase 2.2). No toca días cerrados.';

notify pgrst, 'reload schema';
