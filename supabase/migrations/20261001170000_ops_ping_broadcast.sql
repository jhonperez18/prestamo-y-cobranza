-- Timbre de cambios para todos los aparatos (también el cobrador, que entra sin sesión
-- de Supabase y por RLS no recibe postgres_changes). Solo dice qué tabla cambió; los
-- datos se bajan por la API (service role). Uno por sentencia: una ráfaga = un timbre.

create or replace function public.nexo_ops_ping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('table', tg_table_name),
    'changed',
    'nexo-ops',
    false
  );
  return null;
exception when others then
  -- El timbre nunca puede tumbar una escritura de negocio.
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients',
    'loans',
    'payments',
    'routes',
    'collectors',
    'day_closes',
    'day_expenses',
    'daily_assignments',
    'misc_payments'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists nexo_ops_ping on public.%I', t);
    execute format(
      'create trigger nexo_ops_ping after insert or update or delete on public.%I
         for each statement execute function public.nexo_ops_ping()',
      t
    );
  end loop;
end $$;
