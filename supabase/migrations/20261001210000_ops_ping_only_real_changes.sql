-- Timbre solo con cambio real. Antes sonaba en cada upsert aunque la fila quedara igual:
-- cada aparato rebajaba todo, volvía a subir lo suyo y el timbre sonaba otra vez (ráfagas
-- de >1.000 pedidos por minuto). Ahora compara la fila sin `updated_at`.
-- Postgres no admite tablas de transición en un trigger de varios eventos: uno por evento.

create or replace function public.nexo_ops_ping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    select exists (select 1 from new_rows) into v_changed;
  elsif tg_op = 'DELETE' then
    select exists (select 1 from old_rows) into v_changed;
  else
    select exists (
      select to_jsonb(n) - 'updated_at' from new_rows n
      except
      select to_jsonb(o) - 'updated_at' from old_rows o
    ) into v_changed;
  end if;

  if v_changed then
    perform realtime.send(
      jsonb_build_object('table', tg_table_name),
      'changed',
      'nexo-ops',
      false
    );
  end if;
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
    execute format('drop trigger if exists nexo_ops_ping_ins on public.%I', t);
    execute format('drop trigger if exists nexo_ops_ping_upd on public.%I', t);
    execute format('drop trigger if exists nexo_ops_ping_del on public.%I', t);
    execute format(
      'create trigger nexo_ops_ping_ins after insert on public.%I
         referencing new table as new_rows
         for each statement execute function public.nexo_ops_ping()',
      t
    );
    execute format(
      'create trigger nexo_ops_ping_upd after update on public.%I
         referencing old table as old_rows new table as new_rows
         for each statement execute function public.nexo_ops_ping()',
      t
    );
    execute format(
      'create trigger nexo_ops_ping_del after delete on public.%I
         referencing old table as old_rows
         for each statement execute function public.nexo_ops_ping()',
      t
    );
  end loop;
end $$;
