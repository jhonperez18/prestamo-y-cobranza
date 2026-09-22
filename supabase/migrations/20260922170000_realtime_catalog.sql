-- Cambios de catálogo y dinero llegan a los otros aparatos sin esperar un refresh.
-- La app sigue mandando en local: el pull no pisa una cola pendiente.

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
    'app_users'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
