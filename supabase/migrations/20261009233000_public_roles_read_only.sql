-- La llave pública (anon) viaja en la app: con ella nadie escribe ni lee de más.
-- Escribe solo el servidor (service_role) por sus funciones. El navegador solo:
--   · lee con RLS (tiempo real), y
--   · guarda su perfil al entrar (`profiles`, authenticated).
-- Caso 09/10: las vistas v_* (dueño postgres, sin security_invoker) entregaban a anon
-- todos los préstamos y cobros saltándose RLS.

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;
grant insert, update on public.profiles to authenticated;

revoke all on public.v_loans_enriched, public.v_payments_enriched, public.v_ops_overview
  from anon, authenticated;
alter view public.v_loans_enriched set (security_invoker = true);
alter view public.v_payments_enriched set (security_invoker = true);
alter view public.v_ops_overview set (security_invoker = true);

-- Funciones que mueven plata o saldos: solo el servidor.
revoke execute on function public._loan_settle(text) from public, anon, authenticated;
revoke execute on function public._insert_collection_part(jsonb) from public, anon, authenticated;
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('register_collection', 'register_combined_collection', 'register_day_expense', 'verify_day_cash')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
grant execute on function public._loan_settle(text) to service_role;
grant execute on function public._insert_collection_part(jsonb) to service_role;

-- Lo que se cree después nace igual de cerrado (las funciones de RLS se otorgan a mano).
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
