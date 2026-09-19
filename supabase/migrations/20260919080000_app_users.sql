-- =============================================================================
-- app_users: catálogo de usuarios de negocio (listado admin = login)
-- Raíz compartida entre localhost y Vercel (como clients).
-- profiles = solo puente Auth uid; app_users = UserRow del panel.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  login text not null unique,
  email text,
  password text,
  name text not null default '',
  phone text not null default '',
  document text,
  role_ref text not null,
  collector_ref text,
  channels jsonb not null default '[]'::jsonb,
  permissions jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  last_access text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_ref_format check (ref ~ '^USR-')
);

create index if not exists app_users_role_ref_idx on public.app_users (role_ref);
create index if not exists app_users_active_idx on public.app_users (active);
create index if not exists app_users_collector_ref_idx on public.app_users (collector_ref);

drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

comment on table public.app_users is
  'Catálogo de usuarios del panel (USR-). Fuente de verdad del listado y del login.';

alter table public.app_users enable row level security;

-- Service role / mirrors: sin políticas de escritura para anon (solo lectura vía API server).
drop policy if exists app_users_select_authenticated on public.app_users;
create policy app_users_select_authenticated
  on public.app_users for select
  to authenticated
  using (true);

-- Semilla canónica = listado producción actual (Cristian; sin diego.mora).
insert into public.app_users (
  ref, login, email, password, name, phone, document, role_ref, collector_ref,
  channels, permissions, active, last_access
) values
  (
    'USR-0', 'juan.rios', 'juan.rios@nexo.com', '123', 'Cristian', '310 100 2201', '80.111.001',
    'ROL-1', 'COB-0', '["mobile"]'::jsonb,
    '["clientes.ver","clientes.crear","cobros.registrar","cobros.ver_propios","ruta.ver","ruta.clientes","gps.enviar","evidencias.subir"]'::jsonb,
    true, '27/08 · 10:35'
  ),
  (
    'USR-1', 'lina.soto', 'lina.soto@nexo.com', '123', 'Lina Soto', '311 200 3302', '52.222.002',
    'ROL-1', 'COB-1', '["mobile"]'::jsonb,
    '["clientes.ver","cobros.registrar","cobros.ver_propios","ruta.ver","ruta.clientes","gps.enviar"]'::jsonb,
    true, '27/08 · 08:40'
  ),
  (
    'USR-3', 'truqui', 'jhonefe18@yahoo.es', '123', 'Truqui', '300 000 0000', null,
    'ROL-0', null, '["admin"]'::jsonb,
    '[]'::jsonb,
    true, '27/08 · 09:00'
  ),
  (
    'USR-4', 'supervisor', 'supervisor@nexo.com', '123', 'Carlos', '315 400 5504', '51.444.004',
    'ROL-2', null, '["mobile"]'::jsonb,
    '["clientes.ver","clientes.crear","clientes.aprobar","clientes.editar","prestamos.ver","prestamos.crear","prestamos.editar","cobros.registrar","cobros.ver_propios","ruta.ver","ruta.clientes","gps.enviar","evidencias.subir","reportes.ver","banco.ver"]'::jsonb,
    true, '27/08 · 11:10'
  )
on conflict (ref) do update set
  login = excluded.login,
  email = excluded.email,
  password = excluded.password,
  name = excluded.name,
  phone = excluded.phone,
  document = excluded.document,
  role_ref = excluded.role_ref,
  collector_ref = excluded.collector_ref,
  channels = excluded.channels,
  permissions = excluded.permissions,
  active = excluded.active,
  last_access = excluded.last_access,
  updated_at = timezone('utc', now());
