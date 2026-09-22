-- Caja y cobro: pesos enteros, un solo bloque, reintento sin duplicar.
-- El saldo del préstamo se recalcula desde los PG- vivos. No se acepta un saldo enviado por el cliente.
-- El descuadre queda en cash_variance. collected, expenses y cash_float no se tocan.

alter table public.payments
  add column if not exists idempotency_key text;

create unique index if not exists payments_idempotency_key_uidx
  on public.payments (idempotency_key)
  where idempotency_key is not null and length(btrim(idempotency_key)) > 0;

comment on column public.payments.idempotency_key is
  'Clave del envío (celular o PC). Un reintento con la misma clave no inserta otro PG-.';

alter table public.day_closes
  add column if not exists opening_cash numeric(14, 2) not null default 0,
  add column if not exists cash_expected numeric(14, 2),
  add column if not exists cash_declared numeric(14, 2),
  add column if not exists cash_variance numeric(14, 2) not null default 0;

comment on column public.day_closes.cash_variance is
  'declarado − (saldo inicial + efectivo del día − gastos). No reescribe cobros ni gastos.';

create or replace function public.loan_collected(p_loan_ref text)
returns numeric
language sql
stable
as $$
  select coalesce(sum(trunc(amount)), 0)
  from public.payments
  where loan_ref = p_loan_ref
    and coalesce(payment_type, '') <> 'Anulado';
$$;

comment on function public.loan_collected(text) is
  'Suma de recaudos vivos del préstamo. Un anulado no suma.';

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
begin
  if p_ref is null or btrim(p_ref) = '' or p_ref !~ '^PG-' then
    return jsonb_build_object('ok', false, 'error', 'ref_invalida');
  end if;
  if p_loan_ref is null or btrim(p_loan_ref) = '' then
    return jsonb_build_object('ok', false, 'error', 'prestamo_invalido');
  end if;
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'monto_invalido');
  end if;
  if p_method not in ('efectivo', 'nequi', 'banco') then
    return jsonb_build_object('ok', false, 'error', 'metodo_invalido');
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
      'ref', v_existing.ref
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
    );
  exception
    when unique_violation then
      return jsonb_build_object('ok', true, 'duplicate', true, 'ref', p_ref);
  end;

  v_paid := public.loan_collected(p_loan_ref);

  update public.loans l
  set
    paid = v_paid,
    balance = greatest(
      0,
      trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid
    ),
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
    'ref', p_ref,
    'paid', v_paid,
    'total', v_total,
    'balance', v_balance
  );
end;
$$;

comment on function public.register_collection(
  text, text, numeric, date, text, text, text, text, text, text, date, text, text, text, text, text, jsonb
) is
  'Inserta un PG- y recalcula saldo del préstamo en la misma transacción. La misma idempotency_key no duplica.';

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
  v_total numeric(14, 2) := greatest(0, trunc(coalesce(p_expenses_total, 0)));
begin
  if p_ref is null or btrim(p_ref) = '' then
    return jsonb_build_object('ok', false, 'error', 'ref_invalida');
  end if;

  insert into public.day_expenses (
    ref, collector_ref, collector_name, expense_date, route_ref, expenses, expenses_total
  ) values (
    p_ref,
    p_collector_ref,
    coalesce(p_collector_name, ''),
    p_expense_date,
    coalesce(p_route_ref, ''),
    coalesce(p_expenses, '[]'::jsonb),
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

  return jsonb_build_object('ok', true, 'ref', p_ref, 'expenses_total', v_total);
end;
$$;

comment on function public.register_day_expense(text, text, text, date, text, jsonb, numeric) is
  'Un borrador de gastos por ref (GAS-cobrador-fecha). Reintento reemplaza el mismo documento.';

create or replace function public.verify_day_cash(
  p_ref text,
  p_opening numeric,
  p_collections numeric,
  p_expenses numeric,
  p_declared numeric
)
returns jsonb
language plpgsql
as $$
declare
  v_opening numeric(14, 2) := trunc(coalesce(p_opening, 0));
  v_collections numeric(14, 2) := trunc(coalesce(p_collections, 0));
  v_expenses numeric(14, 2) := trunc(coalesce(p_expenses, 0));
  v_declared numeric(14, 2) := trunc(coalesce(p_declared, 0));
  v_expected numeric(14, 2);
  v_variance numeric(14, 2);
  v_found int;
begin
  v_expected := v_opening + v_collections - v_expenses;
  v_variance := v_declared - v_expected;

  update public.day_closes
  set
    opening_cash = v_opening,
    cash_expected = v_expected,
    cash_declared = v_declared,
    cash_variance = v_variance
  where ref = p_ref;

  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', false, 'error', 'cierre_no_existe');
  end if;

  return jsonb_build_object(
    'ok', true,
    'expected', v_expected,
    'declared', v_declared,
    'variance', v_variance,
    'balanced', v_variance = 0
  );
end;
$$;

comment on function public.verify_day_cash(text, numeric, numeric, numeric, numeric) is
  'Efectivo en caja = inicial + efectivo del día − gastos. Guarda la diferencia y no altera cobros ni líneas de gasto.';

grant execute on function public.loan_collected(text) to anon, authenticated, service_role;
grant execute on function public.register_collection(
  text, text, numeric, date, text, text, text, text, text, text, date, text, text, text, text, text, jsonb
) to anon, authenticated, service_role;
grant execute on function public.register_day_expense(text, text, text, date, text, jsonb, numeric)
  to anon, authenticated, service_role;
grant execute on function public.verify_day_cash(text, numeric, numeric, numeric, numeric)
  to anon, authenticated, service_role;
