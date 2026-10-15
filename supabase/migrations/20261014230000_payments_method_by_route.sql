-- Medio del cobro no efectivo = ruta del cliente (misma regla que `paymentMethodForRoute`):
-- A → 'nequi'; M / T / N → 'banco'. Lo decide la base al guardar, venga del celular, del
-- panel o de un aparato con versión vieja. Un reenvío con el mismo medio no lo toca.

create or replace function public._payments_method_by_route()
returns trigger
language plpgsql
as $function$
declare
  v_route text;
begin
  if tg_op = 'UPDATE' and new.method is not distinct from old.method then
    return new;
  end if;
  if new.method is null or new.method not in ('nequi', 'banco') or new.loan_ref is null then
    return new;
  end if;
  select upper(btrim(c.route)) into v_route
  from public.loans l
  join public.clients c on c.ref = l.client_ref
  where l.ref = new.loan_ref;
  if coalesce(v_route, '') = '' then
    return new;
  end if;
  new.method := case when v_route = 'A' then 'nequi' else 'banco' end;
  return new;
end;
$function$;

drop trigger if exists payments_method_by_route on public.payments;
create trigger payments_method_by_route
  before insert or update of method on public.payments
  for each row execute function public._payments_method_by_route();
