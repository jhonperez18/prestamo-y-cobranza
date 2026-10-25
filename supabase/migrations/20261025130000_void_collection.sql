-- Anulación: un solo dueño en la base.
-- Si el PG- ya existe, solo queda Anulado (monto, fecha y método no se tocan).
-- Si todavía no está, entra ya anulado. El saldo lo calcula _loan_settle.

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
  v_settled := public._loan_settle(v_loan);

  return jsonb_build_object(
    'ok', true,
    'ref', v_existing.ref,
    'loan_ref', v_loan,
    'balance', v_settled.balance
  );
end;
$function$;

revoke all on function public.void_collection(text, text, numeric, date, text, text, text, text, text, text, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.void_collection(text, text, numeric, date, text, text, text, text, text, text, text, date, text, text, text) to service_role;

comment on function public.void_collection(text, text, numeric, date, text, text, text, text, text, text, text, date, text, text, text) is
  'Anula un PG-. No cambia monto, fecha ni método. Si no está, entra ya anulado. El saldo lo calcula _loan_settle.';

notify pgrst, 'reload schema';
