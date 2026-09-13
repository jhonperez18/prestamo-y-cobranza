-- =============================================================================
-- C6.1: endurecer acceso — quitar anon directo; RLS por profiles
-- Las escrituras de la app van por API Next con SERVICE_ROLE (bypasa RLS).
-- Lectura authenticated: admin/supervisor todo; cobrador solo su collector_ref.
-- =============================================================================

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_collector_ref()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select collector_ref from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role_id in ('admin', 'supervisor') from public.profiles where id = auth.uid()),
    false
  )
$$;

comment on function public.is_staff_profile() is
  'True si el JWT Auth pertenece a admin o supervisor en profiles.';

-- ---------------------------------------------------------------------------
-- Quitar políticas anon (ya no acceso directo con anon key)
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and (
        policyname like '%_anon_%'
        or policyname like '%anon_c2%'
        or policyname like '%anon_c5%'
        or policyname like '%anon_c6%'
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PROFILES: cada usuario ve/edita el suyo; staff ve todos
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_select_staff" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_authenticated" on public.profiles;
drop policy if exists "profiles_update_authenticated" on public.profiles;
drop policy if exists "profiles_select_anon_c6" on public.profiles;
drop policy if exists "profiles_insert_anon_c6" on public.profiles;
drop policy if exists "profiles_update_anon_c6" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff_profile());

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_staff_profile())
  with check (id = auth.uid() or public.is_staff_profile());

-- insert de profile lo hace service role / trigger; staff puede insertar
create policy "profiles_insert_staff"
  on public.profiles for insert to authenticated
  with check (public.is_staff_profile() or id = auth.uid());

-- ---------------------------------------------------------------------------
-- Helper: políticas staff-or-own-collector en tablas con collector_ref
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'payments', 'day_closes', 'day_expenses', 'daily_assignments', 'routes'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_staff_or_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_staff', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (
         public.is_staff_profile()
         or collector_ref is not distinct from public.current_collector_ref()
       )',
      t || '_select_staff_or_own', t
    );

    -- Escrituras authenticated solo staff (calle escribe vía API service role)
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_staff_profile())',
      t || '_insert_staff', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_staff_profile()) with check (public.is_staff_profile())',
      t || '_update_staff', t
    );
  end loop;
end $$;

-- clients / loans / collectors / misc: staff full; cobrador lectura
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'loans', 'collectors', 'misc_payments']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_auth', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_staff', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select_auth', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_staff_profile())',
      t || '_insert_staff', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_staff_profile()) with check (public.is_staff_profile())',
      t || '_update_staff', t
    );
  end loop;
end $$;

comment on table public.profiles is
  'C6.1: puente Auth → rol/collector_ref. API ops usa SERVICE_ROLE; anon ya no escribe tablas.';
