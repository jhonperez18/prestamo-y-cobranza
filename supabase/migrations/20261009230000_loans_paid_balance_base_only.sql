-- Pagado y saldo del préstamo: solo los calcula la base desde los PG- (`_loan_settle`).
-- Ningún aparato, ruta de API ni copia vieja los puede escribir (caso 09/10: 16 fichas con
-- `paid` atrasado y saldos viejos en el celular). Alta: nace sin pagos (`paid` = 0).

create or replace function public._loan_settle(p_ref text)
returns public.loans
language plpgsql
as $function$
declare
  v_paid numeric(14, 2) := public.loan_collected(p_ref);
  v_row public.loans%rowtype;
begin
  perform set_config('nexo.loan_settle', 'on', true);
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
  perform set_config('nexo.loan_settle', '', true);
  return v_row;
end;
$function$;

create or replace function public._loans_paid_balance_owner()
returns trigger
language plpgsql
as $function$
begin
  if coalesce(current_setting('nexo.loan_settle', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.paid, 0) <> 0 then
      raise exception 'loan_paid_owned_by_base'
        using hint = 'Un préstamo nace sin pagos; pagado y saldo los calcula _loan_settle.';
    end if;
    return new;
  end if;
  if new.paid is distinct from old.paid or new.balance is distinct from old.balance then
    raise exception 'loan_paid_owned_by_base'
      using hint = 'Pagado y saldo los calcula _loan_settle desde los PG-.';
  end if;
  return new;
end;
$function$;

drop trigger if exists loans_paid_balance_owner on public.loans;
create trigger loans_paid_balance_owner
  before insert or update of paid, balance on public.loans
  for each row execute function public._loans_paid_balance_owner();
