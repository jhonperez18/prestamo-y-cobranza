-- La planilla (N/P, cobro, cierre, Prestar) llega a los otros aparatos al instante,
-- igual que pagos y cierres. Sin esto esperaba el poll de 45 s.

do $$
begin
  if to_regclass('public.daily_assignments') is not null
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'daily_assignments'
    ) then
    alter publication supabase_realtime add table public.daily_assignments;
  end if;
end $$;
