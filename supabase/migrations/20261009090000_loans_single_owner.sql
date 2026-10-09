-- Fase 1 — el préstamo tiene un solo dueño: la base (modelo register_collection).
-- Crear, modificar, renovar y borrar pasan por una función atómica e idempotente.
-- El P- lo asigna la base; pagado y saldo salen de los PG- vivos (loan_collected).
-- Nada de esto reescribe préstamos existentes: solo agrega columnas, secuencia y funciones.

alter table public.loans
  add column if not exists idempotency_key text,
  add column if not exists terms_version integer not null default 0,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

create unique index if not exists loans_idempotency_key_uidx
  on public.loans (idempotency_key)
  where idempotency_key is not null and length(btrim(idempotency_key)) > 0;

comment on column public.loans.idempotency_key is
  'Clave del alta (aparato). Un reintento con la misma clave devuelve el mismo P-, no crea otro.';
comment on column public.loans.terms_version is
  'Sube con cada cambio de términos. Una edición hecha sobre una versión vieja se rechaza.';

create sequence if not exists public.loan_ref_seq;

select setval(
  'public.loan_ref_seq',
  coalesce((select max((substring(ref from '^P-(\d+)$'))::bigint) from public.loans), 0) + 1,
  false
);

-- Misma regla que isLoanActive (lib/mock-data.ts): activo = no finalizado, eliminado ni cancelado.
create or replace function public.loan_status_active(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_status, ''), '\s', '', 'g'))
    not in ('finalizado', 'eliminado', 'cancelado');
$$;

create or replace function public.loan_status_deleted(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_status, ''), '\s', '', 'g')) = 'eliminado';
$$;

-- Mismo texto que loanRenewedInto (lib/loan-renewal-marks.ts).
create or replace function public.loan_renewed_into(p_notes text)
returns text
language sql
immutable
as $$
  select (regexp_match(coalesce(p_notes, ''), 'Cerrado por renovaci[oó]n\s*→\s*(\S+)', 'i'))[1];
$$;

create or replace function public.loan_row_json(l public.loans)
returns jsonb
language sql
stable
as $$
  select to_jsonb(l) - 'id';
$$;

create or replace function public._next_loan_ref()
returns text
language plpgsql
as $$
declare
  v_ref text;
begin
  loop
    v_ref := 'P-' || nextval('public.loan_ref_seq');
    exit when not exists (select 1 from public.loans where ref = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- Bloquea la fila del cliente: dos altas a la vez del mismo cliente quedan en fila.
create or replace function public._lock_client_for_loan(p_client_ref text, p_except_loan text)
returns jsonb
language plpgsql
as $$
declare
  v_open text;
begin
  perform 1
  from public.clients
  where ref = p_client_ref
    and lower(coalesce(status, '')) <> 'eliminado'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'cliente_inexistente', 'code', 409, 'retry', true);
  end if;

  select ref
    into v_open
  from public.loans
  where client_ref = p_client_ref
    and ref is distinct from p_except_loan
    and public.loan_status_active(status)
  order by created_at
  limit 1;

  if v_open is not null then
    return jsonb_build_object('ok', false, 'error', 'client_has_active_loan', 'code', 409, 'ref', v_open);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Términos que manda el aparato (formulario). paid / balance / status los pone la base.
create or replace function public._loan_terms_valid(p jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_capital numeric := trunc(coalesce((p->>'capital')::numeric, 0));
  v_total numeric := trunc(coalesce((p->>'total')::numeric, 0));
begin
  if v_capital <= 0 then
    return 'capital_invalido';
  end if;
  if v_total < v_capital then
    return 'total_invalido';
  end if;
  if nullif(btrim(coalesce(p->>'start_date', '')), '') is null then
    return 'fecha_invalida';
  end if;
  return null;
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

  return jsonb_build_object('ok', true, 'duplicate', false, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
exception
  when unique_violation then
    select * into v_row from public.loans where idempotency_key = v_key;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
    end if;
    return jsonb_build_object('ok', false, 'error', 'conflicto_unico', 'code', 409, 'retry', true);
end;
$$;

comment on function public.create_loan(text, jsonb) is
  'Alta atómica: la base asigna el P-, exige cliente sin préstamo activo y no duplica con la misma clave.';

-- Pagado / saldo / estado desde los PG- vivos (misma regla que register_collection).
create or replace function public._loan_settle(p_ref text)
returns public.loans
language plpgsql
as $$
declare
  v_paid numeric(14, 2) := public.loan_collected(p_ref);
  v_row public.loans%rowtype;
begin
  update public.loans l
  set
    paid = v_paid,
    balance = case
      when public.loan_renewed_into(l.notes) is not null then 0
      else greatest(0, trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid)
    end,
    status = case
      when public.loan_status_deleted(l.status) then l.status
      when public.loan_renewed_into(l.notes) is not null then 'Finalizado'
      when trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid <= 0 then 'Finalizado'
      when l.status = 'Finalizado' then 'Activo'
      else l.status
    end,
    kind = case
      when public.loan_status_deleted(l.status) then l.kind
      when public.loan_renewed_into(l.notes) is not null
        or trunc(coalesce(l.total, l.capital + coalesce(l.interest, 0), 0)) - v_paid <= 0 then 'paid'
      when l.status = 'Finalizado' then 'ok'
      else l.kind
    end
  where l.ref = p_ref
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_loan_terms(
  p_ref text,
  p_terms_version integer,
  p_terms jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_cur public.loans%rowtype;
  v_row public.loans%rowtype;
  v_client text := nullif(btrim(coalesce(p_terms->>'client_ref', '')), '');
  v_check jsonb;
  v_invalid text;
begin
  select * into v_cur from public.loans where ref = p_ref for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409, 'retry', true);
  end if;
  if public.loan_status_deleted(v_cur.status) then
    return jsonb_build_object('ok', false, 'error', 'prestamo_eliminado', 'code', 409, 'loan', public.loan_row_json(v_cur));
  end if;
  if p_terms_version is distinct from v_cur.terms_version then
    return jsonb_build_object('ok', false, 'error', 'version_conflict', 'code', 409, 'loan', public.loan_row_json(v_cur));
  end if;
  v_invalid := public._loan_terms_valid(p_terms);
  if v_invalid is not null then
    return jsonb_build_object('ok', false, 'error', v_invalid, 'code', 400);
  end if;

  v_client := coalesce(v_client, v_cur.client_ref);
  if v_client <> v_cur.client_ref and public.loan_status_active(v_cur.status) then
    v_check := public._lock_client_for_loan(v_client, p_ref);
    if coalesce((v_check->>'ok')::boolean, false) is not true then
      return v_check;
    end if;
  end if;

  update public.loans
  set
    client_ref = v_client,
    client_name = coalesce(p_terms->>'client_name', client_name),
    start_date = btrim(p_terms->>'start_date'),
    due_date = coalesce(p_terms->>'due_date', due_date),
    capital = trunc((p_terms->>'capital')::numeric),
    total = trunc((p_terms->>'total')::numeric),
    notes = p_terms->>'notes',
    rate = (p_terms->>'rate')::numeric,
    frequency = p_terms->>'frequency',
    mode = p_terms->>'mode',
    pact = p_terms->>'pact',
    days = (p_terms->>'days')::integer,
    interest = (p_terms->>'interest')::numeric,
    installment = (p_terms->>'installment')::numeric,
    schedule = p_terms->'schedule',
    terms_pending = coalesce((p_terms->>'terms_pending')::boolean, false),
    terms_version = terms_version + 1
  where ref = p_ref;

  v_row := public._loan_settle(p_ref);
  return jsonb_build_object('ok', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
end;
$$;

comment on function public.update_loan_terms(text, integer, jsonb) is
  'Modificar: solo términos. Pagado/saldo desde PG-. Versión vieja → version_conflict con la ficha de la nube.';

-- Alertas / mora (las calcula el aparato desde la planilla): no tocan términos ni versión.
create or replace function public.set_loan_alerts(
  p_ref text,
  p_status text,
  p_kind text,
  p_collection_alerts integer
)
returns jsonb
language plpgsql
as $$
declare
  v_row public.loans%rowtype;
begin
  if not public.loan_status_active(p_status) then
    return jsonb_build_object('ok', false, 'error', 'estado_invalido', 'code', 400);
  end if;
  update public.loans
  set
    status = p_status,
    kind = coalesce(nullif(btrim(coalesce(p_kind, '')), ''), kind),
    collection_alerts = greatest(0, coalesce(p_collection_alerts, 0))
  where ref = p_ref
    and public.loan_status_active(status)
    and (status, kind, collection_alerts) is distinct from
        (p_status, coalesce(nullif(btrim(coalesce(p_kind, '')), ''), kind), greatest(0, coalesce(p_collection_alerts, 0)))
  returning * into v_row;
  if not found then
    select * into v_row from public.loans where ref = p_ref;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409, 'retry', true);
    end if;
    return jsonb_build_object('ok', true, 'unchanged', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
  end if;
  return jsonb_build_object('ok', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
end;
$$;

comment on function public.set_loan_alerts(text, text, text, integer) is
  'Alerta/mora de un préstamo activo. Nunca finaliza, borra ni revive.';

create or replace function public.renew_loan(
  p_old_ref text,
  p_idempotency_key text,
  p_new jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_old public.loans%rowtype;
  v_new public.loans%rowtype;
  v_open numeric(14, 2);
  v_invalid text;
  v_total numeric(14, 2);
begin
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'clave_requerida', 'code', 400);
  end if;

  select * into v_new from public.loans where idempotency_key = v_key;
  if found then
    select * into v_old from public.loans where ref = p_old_ref;
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'ref', v_new.ref,
      'closed', public.loan_row_json(v_old), 'created', public.loan_row_json(v_new)
    );
  end if;

  select * into v_old from public.loans where ref = p_old_ref for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409, 'retry', true);
  end if;
  if public.loan_renewed_into(v_old.notes) is not null then
    return jsonb_build_object(
      'ok', false, 'error', 'ya_renovado', 'code', 409,
      'ref', public.loan_renewed_into(v_old.notes), 'loan', public.loan_row_json(v_old)
    );
  end if;
  if not public.loan_status_active(v_old.status) then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inactivo', 'code', 409, 'loan', public.loan_row_json(v_old));
  end if;

  v_open := greatest(0, trunc(coalesce(v_old.total, v_old.capital + coalesce(v_old.interest, 0), 0)) - public.loan_collected(p_old_ref));
  if v_open <= 0 then
    return jsonb_build_object('ok', false, 'error', 'sin_saldo', 'code', 409, 'loan', public.loan_row_json(v_old));
  end if;
  -- El capital de la renovación es lo que la nube dice que se debe, no la copia del aparato.
  if trunc(coalesce((p_new->>'capital')::numeric, 0)) <> v_open then
    return jsonb_build_object('ok', false, 'error', 'saldo_cambio', 'code', 409, 'balance', v_open, 'loan', public.loan_row_json(v_old));
  end if;
  -- Mismo texto que loanRenewalOf (lib/loan-renewal-marks.ts).
  if (regexp_match(coalesce(p_new->>'notes', ''), '^Renovaci[oó]n de (\S+)', 'in'))[1] is distinct from p_old_ref then
    return jsonb_build_object('ok', false, 'error', 'notas_renovacion', 'code', 400);
  end if;
  v_invalid := public._loan_terms_valid(p_new);
  if v_invalid is not null then
    return jsonb_build_object('ok', false, 'error', v_invalid, 'code', 400);
  end if;

  v_total := trunc((p_new->>'total')::numeric);

  insert into public.loans (
    ref, client_ref, client_name, start_date, due_date,
    capital, paid, balance, status, kind,
    notes, rate, frequency, mode, pact, days, interest, total, installment, schedule,
    collection_alerts, terms_pending, idempotency_key
  ) values (
    public._next_loan_ref(),
    v_old.client_ref,
    v_old.client_name,
    btrim(p_new->>'start_date'),
    coalesce(p_new->>'due_date', ''),
    v_open,
    0,
    v_total,
    'Activo',
    'ok',
    p_new->>'notes',
    (p_new->>'rate')::numeric,
    p_new->>'frequency',
    p_new->>'mode',
    p_new->>'pact',
    (p_new->>'days')::integer,
    (p_new->>'interest')::numeric,
    v_total,
    (p_new->>'installment')::numeric,
    p_new->'schedule',
    0,
    false,
    v_key
  )
  returning * into v_new;

  update public.loans
  set notes = case
    when nullif(btrim(coalesce(notes, '')), '') is null then 'Cerrado por renovación → ' || v_new.ref
    else btrim(notes) || E'\n' || 'Cerrado por renovación → ' || v_new.ref
  end
  where ref = p_old_ref;
  v_old := public._loan_settle(p_old_ref);

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'ref', v_new.ref,
    'closed', public.loan_row_json(v_old), 'created', public.loan_row_json(v_new)
  );
end;
$$;

comment on function public.renew_loan(text, text, jsonb) is
  'Renovar en un paso: cierra el viejo y crea la continuación (P- de la base). Sin plata. Capital = saldo de la nube.';

create or replace function public.delete_loan(p_ref text, p_by text)
returns jsonb
language plpgsql
as $$
declare
  v_row public.loans%rowtype;
  v_by text := nullif(btrim(coalesce(p_by, '')), '');
begin
  if v_by is null then
    return jsonb_build_object('ok', false, 'error', 'falta_quien', 'code', 400);
  end if;
  select * into v_row from public.loans where ref = p_ref for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'prestamo_inexistente', 'code', 409);
  end if;
  if public.loan_status_deleted(v_row.status) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
  end if;

  update public.loans
  set status = 'Eliminado', deleted_at = now(), deleted_by = v_by
  where ref = p_ref
  returning * into v_row;

  -- Visitas abiertas (sin cobro ni cierre): fuera de la planilla. Lo cobrado y lo cerrado queda.
  delete from public.daily_assignments
  where loan_ref = p_ref
    and day_closed_at is null
    and payment_ref is null;

  return jsonb_build_object('ok', true, 'duplicate', false, 'ref', v_row.ref, 'loan', public.loan_row_json(v_row));
end;
$$;

comment on function public.delete_loan(text, text) is
  'Baja de préstamo (Borrar del dueño/admin): estado Eliminado + quién/cuándo; saca sus visitas abiertas.';

revoke all on function public.create_loan(text, jsonb) from public, anon, authenticated;
revoke all on function public.update_loan_terms(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.set_loan_alerts(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.renew_loan(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_loan(text, text) from public, anon, authenticated;
revoke all on function public._next_loan_ref() from public, anon, authenticated;
revoke all on function public._lock_client_for_loan(text, text) from public, anon, authenticated;

grant execute on function public.create_loan(text, jsonb) to service_role;
grant execute on function public.update_loan_terms(text, integer, jsonb) to service_role;
grant execute on function public.set_loan_alerts(text, text, text, integer) to service_role;
grant execute on function public.renew_loan(text, text, jsonb) to service_role;
grant execute on function public.delete_loan(text, text) to service_role;
grant usage, select on sequence public.loan_ref_seq to service_role;

-- Cobro: pagado / saldo / estado con la misma regla (_loan_settle). Un cobro tardío a un
-- préstamo renovado ya no lo reabre. Resto de la función igual a la versión en la nube.
CREATE OR REPLACE FUNCTION public.register_collection(p_ref text, p_loan_ref text, p_amount numeric, p_paid_date date, p_method text, p_idempotency_key text DEFAULT NULL::text, p_client_ref text DEFAULT NULL::text, p_collector_ref text DEFAULT NULL::text, p_collector_name text DEFAULT NULL::text, p_paid_time text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_charge_label text DEFAULT NULL::text, p_source text DEFAULT 'pwa'::text, p_payment_type text DEFAULT NULL::text, p_payment_kind text DEFAULT NULL::text, p_route_ref text DEFAULT NULL::text, p_evidence jsonb DEFAULT NULL::jsonb)
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

  v_settled := public._loan_settle(p_loan_ref);
  v_total := trunc(coalesce(v_settled.total, v_settled.capital + coalesce(v_settled.interest, 0), 0));
  v_balance := v_settled.balance;

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
  v_balance := (public._loan_settle(v_loan)).balance;

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
$function$;
