-- Banco y Nequi. Solo lee. No toca la caja ni el CIE.
-- A → Nequi. M y T → Banco. N → Banco solo si el cobro es banco o de oficina.
-- El efectivo no entra. Del préstamo sale solo el capital.
-- Saldo = último cuadre + cobros posteriores − capitales posteriores.

create or replace function public.digital_pool_balances()
returns jsonb
language plpgsql
stable
as $function$
declare
  v_banco_anchor date := date '2026-09-30';
  v_nequi_anchor date := date '2026-09-30';
  v_banco_real numeric(14, 2) := 0;
  v_nequi_real numeric(14, 2) := 0;
  v_banco_set boolean := false;
  v_nequi_set boolean := false;
  v_banco_in numeric(14, 2) := 0;
  v_nequi_in numeric(14, 2) := 0;
  v_banco_out numeric(14, 2) := 0;
  v_nequi_out numeric(14, 2) := 0;
  v_row record;
begin
  for v_row in
    select d.close_date,
           split_part(entry, ':', 1) as kind,
           nullif(split_part(split_part(entry, ':', 2), '|', 2), '')::numeric as real,
           split_part(split_part(entry, ':', 2), '|', 3) as at
    from public.day_closes d
    cross join lateral jsonb_array_elements_text(coalesce(d.movement_refs, '[]'::jsonb)) as entry
    where entry like 'AJUSTE@POOL-BANCO:%'
       or entry like 'AJUSTE@POOL-NEQUI:%'
    order by d.close_date desc, split_part(split_part(entry, ':', 2), '|', 3) desc
  loop
    if v_row.kind = 'AJUSTE@POOL-BANCO' and not v_banco_set then
      v_banco_anchor := v_row.close_date;
      v_banco_real := coalesce(v_row.real, 0);
      v_banco_set := true;
    elsif v_row.kind = 'AJUSTE@POOL-NEQUI' and not v_nequi_set then
      v_nequi_anchor := v_row.close_date;
      v_nequi_real := coalesce(v_row.real, 0);
      v_nequi_set := true;
    end if;
  end loop;

  select
    coalesce(sum(trunc(p.amount)) filter (
      where upper(btrim(c.route)) in ('M', 'T')
         or (
           upper(btrim(c.route)) = 'N'
           and (
             lower(btrim(coalesce(p.method, ''))) = 'banco'
             or p.source = 'caja'
             or lower(btrim(coalesce(p.collector_name, ''))) = 'caja / oficina'
           )
         )
    ), 0),
    coalesce(sum(trunc(p.amount)) filter (where upper(btrim(c.route)) = 'A'), 0)
    into v_banco_in, v_nequi_in
  from public.payments p
  join public.loans l on l.ref = p.loan_ref
  join public.clients c on c.ref = l.client_ref
  where coalesce(p.payment_type, '') <> 'Anulado'
    and coalesce(p.charge_label, '') not like 'ANULADO:%'
    and lower(btrim(coalesce(p.method, ''))) <> 'efectivo'
    and (
      (upper(btrim(c.route)) = 'A' and p.paid_date > v_nequi_anchor)
      or (
        upper(btrim(c.route)) in ('M', 'T', 'N')
        and p.paid_date > v_banco_anchor
      )
    );

  select
    coalesce(sum(trunc(l.capital)) filter (
      where l.notes like '%[[fb:banco]]%'
        and l.notes not like '%[[fb:nequi]]%'
        and upper(btrim(c.route)) in ('M', 'T', 'N')
        and coalesce(l.status, '') <> 'Eliminado'
        and case
          when l.start_date ~ '^\d{4}-\d{2}-\d{2}' then left(l.start_date, 10)::date
          when l.start_date ~ '^\d{2}/\d{2}/\d{4}' then to_date(left(l.start_date, 10), 'DD/MM/YYYY')
          else null
        end > v_banco_anchor
    ), 0),
    coalesce(sum(trunc(l.capital)) filter (
      where l.notes like '%[[fb:nequi]]%'
        and upper(btrim(c.route)) = 'A'
        and coalesce(l.status, '') <> 'Eliminado'
        and case
          when l.start_date ~ '^\d{4}-\d{2}-\d{2}' then left(l.start_date, 10)::date
          when l.start_date ~ '^\d{2}/\d{2}/\d{4}' then to_date(left(l.start_date, 10), 'DD/MM/YYYY')
          else null
        end > v_nequi_anchor
    ), 0)
    into v_banco_out, v_nequi_out
  from public.loans l
  join public.clients c on c.ref = l.client_ref;

  return jsonb_build_object(
    'ok', true,
    'banco', v_banco_real + v_banco_in - v_banco_out,
    'nequi', v_nequi_real + v_nequi_in - v_nequi_out
  );
end;
$function$;

revoke all on function public.digital_pool_balances() from public, anon, authenticated;
grant execute on function public.digital_pool_balances() to service_role;

comment on function public.digital_pool_balances() is
  'Lee Banco y Nequi. A solo Nequi. M, T y N solo Banco. No escribe nada.';

notify pgrst, 'reload schema';
